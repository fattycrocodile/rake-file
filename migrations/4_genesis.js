const genesis = require("./genesis.config.js")
const ContractDeployer = require("../utils/contractDeployer")
const {contractId} = require("../utils/helpers")

const Controller = artifacts.require("Controller")
const ManagerProxy = artifacts.require("ManagerProxy")
const LivepeerToken = artifacts.require("LivepeerToken")
const GenesisManager = artifacts.require("GenesisManager")
const TokenDistributionMock = artifacts.require("TokenDistributionMock")

module.exports = function(deployer, network, accounts) {
    deployer.then(async () => {
        const lpDeployer = new ContractDeployer(deployer, Controller, ManagerProxy)

        const controller = await Controller.deployed()

        const tokenAddr = await controller.getContract(contractId("LivepeerToken"))
        const minterAddr = await controller.getContract(contractId("Minter"))

        const token = await LivepeerToken.at(tokenAddr)

        const dummyTokenDistribution = await lpDeployer.deploy(TokenDistributionMock, genesis.dummyTokenDistribution.timeToEnd)

        let genesisManager

        if (!lpDeployer.isProduction(network)) {
            // If not in production, send the company supply to the deployment account instead of the bank multisig
            genesisManager = await lpDeployer.deploy(GenesisManager, tokenAddr, dummyTokenDistribution.address, accounts[0], minterAddr)
        } else {
            genesisManager = await lpDeployer.deploy(GenesisManager, tokenAddr, dummyTokenDistribution.address, genesis.bankMultisig, minterAddr)
        }

        deployer.logger.log("Transferring ownership of the LivepeerToken to the GenesisManager...")

        await token.transferOwnership(genesisManager.address)

        deployer.logger.log("Setting genesis token allocations...")

        await genesisManager.setAllocations(
            genesis.initialSupply,
            genesis.crowdSupply,
            genesis.companySupply,
            genesis.teamSupply,
            genesis.investorsSupply,
            genesis.communitySupply
        )

        deployer.logger.log("Starting genesis and allocating a 0 crowd supply to the dummy token distribution...")

        await genesisManager.start()

        deployer.logger.log("Adding team token grants...")

        await Promise.all(genesis.teamGrants.map(grant => {
            return genesisManager.addTeamGrant(grant.receiver, grant.amount, grant.timeToCliff, grant.vestingDuration)
        }))

        deployer.logger.log("Adding investor token grants...")

        await Promise.all(genesis.investorGrants.map(grant => {
            return genesisManager.addInvestorGrant(grant.receiver, grant.amount, grant.timeToCliff, grant.vestingDuration)
        }))

        deployer.logger.log("Adding community token grants...")

        await Promise.all(genesis.communityGrants.map(grant => {
            return genesisManager.addCommunityGrant(grant.receiver, grant.amount)
        }))

        deployer.logger.log("Finalizing dummy token distribution...")

        await dummyTokenDistribution.finalize()

        deployer.logger.log("Ending genesis and transferring ownership of the LivepeerToken to the protocol Minter...")

        await genesisManager.end()

        if (!lpDeployer.isProduction(network)) {
            // If not in production, the deployment account holds the company supply
            // and use some of those tokens to fund the faucet supply
            deployer.logger.log("Not in production - deployment account will fund the deployed faucet")

            const faucetAddr = await controller.getContract(contractId("LivepeerTokenFaucet"))
            await token.transfer(faucetAddr, genesis.faucetSupply)
        } else {
            // If in production, transfer ownership of the Controller to the governance multisig
            deployer.logger.log(`In production - transferring ownership of the Controller at ${controller.address} to the governance multisig ${genesis.governanceMultisig}`)

            await controller.transferOwnership(genesis.governanceMultisig)

            const newOwner = await controller.owner()
            deployer.logger.log(`Controller at ${controller.address} is now owned by ${newOwner}`)
        }
    })
}

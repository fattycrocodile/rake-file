// Taken from https://github.com/aragon/aragonOS/blob/bfed147dd906a7ecb39dd36848353986d21134cc/test/helpers/runSolidityTest.js

const HOOKS_MAP = {
    beforeAll: "before",
    beforeEach: "beforeEach",
    afterEach: "afterEach",
    afterAll: "afterAll"
}

const processResult = receipt => {
    if (!receipt) {
        return
    }
    receipt.logs.forEach(log => {
        if (log.event === "TestEvent" && log.args.result !== true) {
            throw new Error(log.args.message)
        }
    })
}

/**
 * Deploy and link `libName` to provided contract artifact.
 * Modifies bytecode in place
 * 
 * @param {string} contract Contract name
 * @param {string} libName Library name
*/
const linkLib = async (contract, libName) => {
    const underscores = n => "_".repeat(n)
    const PREFIX_UNDERSCORES = 2
    const ADDR_LENGTH = 40

    const prefix = underscores(PREFIX_UNDERSCORES)
    const suffix = underscores(ADDR_LENGTH - PREFIX_UNDERSCORES - libName.length)
    const libPlaceholder = `${prefix}${libName}${suffix}`

    const lib = await artifacts.require(libName).new()
    const libAddr = lib.address.replace("0x", "").toLowerCase()

    contract.bytecode = contract.bytecode.replace(new RegExp(libPlaceholder, "g"), libAddr)
}

/**
 * Runs a solidity test file, via javascript.
 * Required to smooth over some technical problems in solidity-coverage
 * 
 * @param {string} c Name of Solidity test file
 * @param {Array} libs Array of names of Solidity libraries to link with test file
 * @param {Object} mochaContext Mocha context
*/
function runSolidityTest(c, libs, mochaContext) {
    const artifact = artifacts.require(c)
    contract(c, () => {
        let deployed

        before(async () => {
            await linkLib(artifact, "Assert")

            if (libs) {
                for (let lib of libs) {
                    await linkLib(artifact, lib)
                }
            }

            deployed = await artifact.new()
        })

        mochaContext("> Solidity test", () => {
            artifact.abi.forEach(iface => {
                if (iface.type === "function") {
                    if (["beforeAll", "beforeEach", "afterEach", "afterAll"].includes(iface.name)) {
                        // Set up hooks
                        global[HOOKS_MAP[iface.name]](() => {
                            return deployed[iface.name]().then(processResult)
                        })
                    } else if (iface.name.startsWith("test")) {
                        it(iface.name, () => {
                            return deployed[iface.name]().then(processResult)
                        })
                    }
                }
            })
        })
    })
}

// Bind the functions for ease of use, and provide .only() and .skip() hooks
const fn = (c, libs) => runSolidityTest(c, libs, context)
fn.only = (c, libs) => runSolidityTest(c, libs, context.only)
fn.skip = (c, libs) => runSolidityTest(c, libs, context.skip)

module.exports = fn

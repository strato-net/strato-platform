/**
 * Contract utilities for working with Solidity contracts
 */
const fs = require("fs-extra");
const path = require("path");
const { rest, importer, util } = require("blockapps-rest");
const { createContract, getState } = rest;
const config = require("./config");

/**
 * Find code collection contract file in the contracts directory
 * @param {string} contractsDir - Path to contracts directory
 * @param {string} fileName - Code collection file name
 * @returns {string} Path to code collection contract file
 */
function findMainContractFile(contractsDir, fileName) {
  // Ensure contracts directory exists
  if (!fs.existsSync(contractsDir)) {
    throw new Error(`Contracts directory not found: ${contractsDir}`);
  }

  // Get all .sol files
  const files = fs
    .readdirSync(contractsDir)
    .filter((file) => file.endsWith(".sol"));

  if (files.length === 0) {
    throw new Error(`No Solidity files found in ${contractsDir}`);
  }

  // Check if code collection file exists
  const filePath = path.join(contractsDir, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Code ollection contract file not found: ${filePath}`);
  }

  return filePath;
}

/**
 * Deploy a contract
 * @param {object} token - Token object with token property
 * @param {object} options - Deployment options
 * @returns {Promise<object>} Deployed contract
 */
async function uploadDappContract(token, options) {
  const contractsDir = config.resolvePath(config.contractsDir);

  // Find main contract file
  const contractFilePath = findMainContractFile(contractsDir, config.mainFile);

  // Get contract name
  const contractName = config.appName;

  console.log(`Code collection contract file: ${contractFilePath}`);
  console.log(`Contract name: ${contractName}`);

  try {
    // Combine all contracts
    console.log("Combining contract source files...");
    let source = await importer.combine(contractFilePath);

    const stripComments = (str) => {
      // Remove block comments
      let out = str.replace(/\/\*[\s\S]*?\*\//g, "");
      // Remove line comments but keep SPDX license
      out = out
        .split("\n")
        .map((ln) => {
          const t = ln.trim();
          if (t.startsWith("//")) {
            return t.includes("SPDX-License-Identifier") ? ln : "";
          }
          return ln.replace(/\/\/.*$/, "");
        })
        .join("\n");
      return out;
    };

    if (Buffer.isBuffer(source)) {
      source = stripComments(source.toString());
    } else if (typeof source === "object") {
      const processed = Object.keys(source).map((k) => {
        let content = source[k];
        content = typeof content === "string" ? content : String(content);
        // Remove filename prefix like "File.sol,"
        content = content.replace(/^.*?\.sol,\s*/i, "");
        return stripComments(content);
      });
      source = processed.join("\n");
    } else if (typeof source === "string") {
      source = stripComments(source);
    } else {
      source = stripComments(String(source));
    }

    console.log("Comments stripped from combined source(s)");

    // Deployment arguments
    const contractArgs = {
      name: contractName,
      source,
      args: {}, // No constructor arguments needed
      txParams: {
        gasPrice: config.gasPrice,
        gasLimit: config.gasLimit,
      },
    };

    // Options for deployment
    const deployOptions = {
      ...options,
      config,
      history: [contractName],
      cacheNonce: true,
    };

    // Deploy the contract
    console.log(`Deploying contract ${contractName}...`);
    const contract = await createContract(token, contractArgs, deployOptions);
    const contractState = await util.until(
      (r) => r && r.lendingPool,
      (opts) => getState(token, contract, opts),
      options
    );
    // Remove source code from the result (it can be large)
    contract.src = "removed";

    console.log(`Contract deployed successfully!`);
    console.log(`Contract address: ${contract.address}`);

    return { ...contract, managers: contractState };
  } catch (error) {
    console.error("Error deploying contract:", error);
    throw error;
  }
}

module.exports = {
  uploadDappContract,
};

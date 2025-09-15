// Load environment variables from .env file
require('dotenv').config();

const { getEnvVar, callListAndWait } = require("../../deploy/util");
const { ethers } = require("ethers");
const fs = require('fs');
const path = require('path');

// Hardcoded token addresses (without 0x prefix)
const TOKEN_ADDRESSES = {
  USDST: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  bCSPXST: "47de839c03a3b014c0cc4f3b9352979a5038f910",
  SILVST: "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94",
  GOLDST: "cdc93d30182125e05eec985b631c7c61b3f63ff0",
  WBTCST: "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9",
  ETHST: "93fb7295859b2d70199e0a4883b7c320cf874e6c"
};

/**
 * Parse array input from environment variable (comma-separated values)
 */
function parseArrayFromEnv(envVar) {
  if (!envVar) return [];
  return envVar.split(',').map(item => item.trim()).filter(item => item);
}

/**
 * Get user addresses from environment variables (supports both single and array)
 */
function getUserAddressesFromEnv() {
  try {
    const singleAddress = getEnvVar('USER_ADDRESS');
    if (singleAddress) {
      // Check if USER_ADDRESS contains comma-separated values
      if (singleAddress.includes(',')) {
        return parseArrayFromEnv(singleAddress);
      }
      return [singleAddress];
    }
  } catch (error) {
    // USER_ADDRESS not set, try USER_ADDRESSES
  }

  try {
    const addressArray = getEnvVar('USER_ADDRESSES');
    return parseArrayFromEnv(addressArray);
  } catch (error) {
    throw new Error('Either USER_ADDRESS or USER_ADDRESSES must be set');
  }
}

/**
 * Get token amounts from environment variables and convert to wei
 * Supports both single amounts and arrays
 */
function getTokenAmountsFromEnv() {
  const amounts = {};
  const tokens = ['USDST', 'bCSPXST', 'SILVST', 'GOLDST', 'WBTCST', 'ETHST'];

  tokens.forEach(token => {
    try {
      // Try single amount first
      const singleAmount = getEnvVar(token);
      if (singleAmount && parseFloat(singleAmount) > 0) {
        const weiAmount = ethers.parseEther(singleAmount);
        amounts[token] = [weiAmount.toString()];
        console.log(`  ${token}: ${singleAmount} (${weiAmount.toString()} wei)`);
        return;
      }
    } catch (error) {
      // Single amount not set, try array
    }

    try {
      // Try array amounts
      const arrayAmounts = getEnvVar(`${token}_ARRAY`);
      if (arrayAmounts) {
        const parsedAmounts = parseArrayFromEnv(arrayAmounts);
        if (parsedAmounts.length > 0) {
          const weiAmounts = parsedAmounts
            .filter(amount => parseFloat(amount) > 0)
            .map(amount => {
              const weiAmount = ethers.parseEther(amount);
              console.log(`  ${token}: ${amount} (${weiAmount.toString()} wei)`);
              return weiAmount.toString();
            });
          if (weiAmounts.length > 0) {
            amounts[token] = weiAmounts;
          }
        }
      }
    } catch (error) {
      // Array amounts not set, skip token
    }
  });

  return amounts;
}

function createTransferCalls(userAddresses, tokenAmounts) {
  const calls = [];

  Object.entries(tokenAmounts).forEach(([token, weiAmounts]) => {
    weiAmounts.forEach((weiAmount, amountIndex) => {
      userAddresses.forEach(userAddress => {
        calls.push({
          contract: { address: TOKEN_ADDRESSES[token], name: "ERC20" },
          method: "transfer",
          args: {
            to: userAddress,
            value: weiAmount,
          },
          metadata: {
            token,
            userAddress,
            weiAmount,
            amountIndex
          }
        });
      });
    });
  });

  return calls;
}

function generateTransferReport(userAddresses, tokenAmounts, transferCalls, results) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalTransfers: results.length,
      successfulTransfers: 0,
      failedTransfers: 0,
      totalAmountTransferred: 0,
      userAddresses: userAddresses,
      tokensProcessed: new Set(),
      transfersByUser: {}
    },
    successfulTransfers: [],
    failedTransfers: [],
    errors: []
  };

  // Initialize user transfer counts
  userAddresses.forEach(address => {
    report.summary.transfersByUser[address] = {
      successful: 0,
      failed: 0,
      totalAmount: 0
    };
  });

  results.forEach((result, index) => {
    const call = transferCalls[index];
    const { token, userAddress, weiAmount } = call.metadata;
    const amount = ethers.formatEther(weiAmount);

    if (result.status === 'Success') {
      report.summary.successfulTransfers++;
      report.summary.totalAmountTransferred += parseFloat(amount);
      report.summary.tokensProcessed.add(token);
      report.summary.transfersByUser[userAddress].successful++;
      report.summary.transfersByUser[userAddress].totalAmount += parseFloat(amount);

      report.successfulTransfers.push({
        recipientAddress: userAddress,
        token: token,
        tokenAddress: TOKEN_ADDRESSES[token],
        amount: amount,
        weiAmount: weiAmount,
        transactionHash: result.hash,
        status: result.status
      });
    } else {
      // Robust error extraction (matches repo best practice)
      let errorMsg = String(
        result.error ||
        result.message ||
        result.reason ||
        (result.txResult && result.txResult.message) ||
        ""
      ) || "Unknown error";

      report.summary.failedTransfers++;
      report.summary.transfersByUser[userAddress].failed++;

      const failedTransfer = {
        recipientAddress: userAddress,
        token: token,
        tokenAddress: TOKEN_ADDRESSES[token],
        amount: amount,
        weiAmount: weiAmount,
        transactionHash: result.hash,
        status: result.status,
        error: errorMsg
      };
      report.failedTransfers.push(failedTransfer);
      report.errors.push(`${token} transfer to ${userAddress} failed with status ${result.status}`);
    }
  });

  report.summary.tokensProcessed = Array.from(report.summary.tokensProcessed);

  return report;
}

function saveTransferReport(report) {
  const reportDir = path.join(__dirname, 'transfer-logs');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  
  const filename = `contest-transfer-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filePath = path.join(reportDir, filename);
  
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  
  return filePath;
}

async function transferTokens() {
  try {
    const userAddresses = getUserAddressesFromEnv();
    const tokenAmounts = getTokenAmountsFromEnv();

    if (Object.keys(tokenAmounts).length === 0) {
      console.log('No token amounts found in environment variables');
      return;
    }

    if (userAddresses.length === 0) {
      console.log('No user addresses found in environment variables');
      return;
    }

    console.log(`Transferring to ${userAddresses.length} address(es):`);
    userAddresses.forEach((address, index) => {
      console.log(`  [${index + 1}] ${address}`);
    });
    console.log();

    const transferCalls = createTransferCalls(userAddresses, tokenAmounts);
    console.log(`Executing ${transferCalls.length} transfers...`);

    const results = await callListAndWait(transferCalls);

    const report = generateTransferReport(userAddresses, tokenAmounts, transferCalls, results);
    const reportPath = saveTransferReport(report);

    console.log(`\nResults: ${report.summary.successfulTransfers}/${report.summary.totalTransfers} successful`);

    // Show per-user summary
    console.log('\nPer-user summary:');
    Object.entries(report.summary.transfersByUser).forEach(([address, stats]) => {
      console.log(`  ${address}: ${stats.successful} successful, ${stats.failed} failed, ${stats.totalAmount.toFixed(6)} tokens transferred`);
    });

    if (report.failedTransfers.length > 0) {
      console.log('\nFailed transfers:');
      report.failedTransfers.forEach(transfer => {
        let msg = `  ${transfer.token} to ${transfer.recipientAddress}: ${transfer.status} (tx: ${transfer.transactionHash || 'N/A'})`;
        if (transfer.error) msg += `\n    Error: ${transfer.error}`;
        console.log(msg);
      });
    }

    console.log(`\nTransfer report saved to: ${reportPath}`);

  } catch (error) {
    console.error('Script failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  console.error('Set environment variables:');
  console.error('  USER_ADDRESS - Single target user address, OR');
  console.error('  USER_ADDRESSES - Comma-separated list of target user addresses');
  console.error('  Token amounts (in token units, not wei):');
  console.error('    Single amounts: USDST, bCSPXST, SILVST, GOLDST, WBTCST, ETHST');
  console.error('    Array amounts: USDST_ARRAY, bCSPXST_ARRAY, etc. (comma-separated)');

  (async () => {
    try {
      await transferTokens();
    } catch (error) {
      console.error('Script execution failed:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = {
  transferTokens,
  getTokenAmountsFromEnv,
  getUserAddressesFromEnv,
  createTransferCalls,
  generateTransferReport,
  parseArrayFromEnv
}; 
// Load environment variables from .env file
require('dotenv').config();

const { getEnvVar, callListAndWait } = require("../../deploy/util");
const { ethers } = require("ethers");
const fs = require('fs');
const path = require('path');

// Hardcoded token addresses (without 0x prefix)
const TOKEN_ADDRESSES = {
  USDST: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  SILVST: "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94",
  GOLDST: "cdc93d30182125e05eec985b631c7c61b3f63ff0",
  WBTCST: "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9",
  ETHST: "93fb7295859b2d70199e0a4883b7c320cf874e6c"
};

/**
 * Get token amounts from environment variables and convert to wei
 */
function getTokenAmountsFromEnv() {
  const amounts = {};
  const tokens = ['USDST', 'bCSPXST', 'SILVST', 'GOLDST', 'WBTCST', 'ETHST'];
  
  tokens.forEach(token => {
    try {
      const amount = getEnvVar(token);
      if (amount && parseFloat(amount) > 0) {
        // Convert to wei (assuming 18 decimals for all tokens)
        const weiAmount = ethers.parseEther(amount);
        amounts[token] = weiAmount.toString();
        console.log(`  ${token}: ${amount} (${weiAmount.toString()} wei)`);
      }
    } catch (error) {
      // Token amount not set in env, skip it
    }
  });
  
  return amounts;
}

function createTransferCalls(userAddress, tokenAmounts) {
  const calls = [];
  
  Object.entries(tokenAmounts).forEach(([token, weiAmount]) => {
    calls.push({
      contract: { address: TOKEN_ADDRESSES[token], name: "ERC20" },
      method: "transfer",
      args: {
        to: userAddress,
        value: weiAmount,
      }
    });
  });
  
  return calls;
}

function generateTransferReport(userAddresses, tokenAmounts, allResults) {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalTransfers: 0,
      successfulTransfers: 0,
      failedTransfers: 0,
      totalAmountTransferred: 0,
      userAddresses: userAddresses,
      tokensProcessed: new Set()
    },
    successfulTransfers: [],
    failedTransfers: [],
    errors: []
  };

  const tokenEntries = Object.entries(tokenAmounts);

  userAddresses.forEach((userAddress, userIndex) => {
    const results = allResults[userIndex];
    report.summary.totalTransfers += results.length;

    results.forEach((result, index) => {
      const [token, weiAmount] = tokenEntries[index];

      if (result.status === 'Success') {
        report.summary.successfulTransfers++;
        report.summary.totalAmountTransferred += parseFloat(ethers.formatEther(weiAmount));
        report.summary.tokensProcessed.add(token);

        report.successfulTransfers.push({
          recipientAddress: userAddress,
          token: token,
          tokenAddress: TOKEN_ADDRESSES[token],
          amount: ethers.formatEther(weiAmount),
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
        const failedTransfer = {
          recipientAddress: userAddress,
          token: token,
          tokenAddress: TOKEN_ADDRESSES[token],
          amount: ethers.formatEther(weiAmount),
          weiAmount: weiAmount,
          transactionHash: result.hash,
          status: result.status,
          error: errorMsg
        };
        report.failedTransfers.push(failedTransfer);
        report.errors.push(`${token} transfer to ${userAddress} failed with status ${result.status}`);
      }
    });
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
    const userAddressesStr = getEnvVar('USER_ADDRESSES');
    const userAddresses = userAddressesStr.split(',').map(addr => addr.trim());
    const tokenAmounts = getTokenAmountsFromEnv();

    if (Object.keys(tokenAmounts).length === 0) {
      console.log('No token amounts found in environment variables');
      return;
    }

    if (userAddresses.length === 0) {
      console.log('No user addresses found in USER_ADDRESSES');
      return;
    }

    console.log(`Transferring to ${userAddresses.length} user(s):`);
    userAddresses.forEach(addr => console.log(`  - ${addr}`));
    console.log('');

    const allResults = [];

    for (const userAddress of userAddresses) {
      console.log(`Processing transfers for ${userAddress}...`);
      const transferCalls = createTransferCalls(userAddress, tokenAmounts);
      const results = await callListAndWait(transferCalls);
      allResults.push(results);
      console.log(`  Completed ${results.length} transfers\n`);
    }

    const report = generateTransferReport(userAddresses, tokenAmounts, allResults);
    const reportPath = saveTransferReport(report);

    console.log(`\nResults: ${report.summary.successfulTransfers}/${report.summary.totalTransfers} successful`);
    if (report.failedTransfers.length > 0) {
      console.log('\nFailed transfers:');
      report.failedTransfers.forEach(transfer => {
        let msg = `  ${transfer.recipientAddress} - ${transfer.token}: ${transfer.status} (tx: ${transfer.transactionHash || 'N/A'})`;
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
  console.error('  USER_ADDRESSES - Comma-separated list of target user addresses');
  console.error('  USDST, bCSPXST, SILVST, GOLDST, WBTCST, ETHST - Token amounts (in token units, not wei)');

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
  createTransferCalls,
  generateTransferReport
}; 
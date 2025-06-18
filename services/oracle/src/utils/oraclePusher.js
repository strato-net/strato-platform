require('dotenv').config();
const axios = require('axios');
const { oauthClient } = require('./oauth');

// STRATO transaction builder utilities
const DEFAULT_GAS_PARAMS = {
    gasLimit: 32_100_000_000,
    gasPrice: 1,
};

function buildFunctionTx({ contractName, contractAddress, method, args }) {
    const tx = {
        type: "FUNCTION",
        payload: { contractName, contractAddress, method, args },
    };

    return {
        txs: [tx],
        txParams: DEFAULT_GAS_PARAMS,
    };
}

// STRATO interaction utilities
async function callListAndWait(callListArgs, retryCount = 0) {
    const maxRetries = 3;
    
    try {
        const accessToken = await oauthClient.getAccessToken();
        
        // Submit transaction to STRATO using the parallel endpoint
        const response = await axios.post(
            `${process.env.STRATO_NODE_URL}/bloc/v2.2/transaction/parallel`,
            {
                txs: callListArgs.map(callArg => ({
                    type: "FUNCTION",
                    payload: {
                        contractName: callArg.contract.name,
                        contractAddress: callArg.contract.address,
                        method: callArg.method,
                        args: callArg.args
                    }
                })),
                txParams: DEFAULT_GAS_PARAMS
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );



        // Handle different response formats
        let txHash;
        if (Array.isArray(response.data) && response.data.length > 0) {
            txHash = response.data[0].hash || response.data[0];
        } else if (response.data && response.data.hash) {
            txHash = response.data.hash;
        } else if (typeof response.data === 'string') {
            txHash = response.data;
        } else {
            throw new Error('No transaction hash returned from STRATO');
        }

        console.log(`[OraclePusher] Transaction submitted: ${txHash}`);

        // Wait for transaction confirmation
        return await waitForTransaction(txHash);
    } catch (error) {
        const errorMessage = error.response?.data?.message || error.message;
        
        // Check if this is a mempool rejection and we can retry
        if (errorMessage.includes('Rejected from mempool') && retryCount < maxRetries) {
            console.log(`[OraclePusher] Transaction rejected from mempool (attempt ${retryCount + 1}/${maxRetries + 1}). Retrying after delay...`);
            
            // Wait longer between retries to avoid nonce conflicts
            const delay = 2000 + (retryCount * 3000); // 2s, 5s, 8s delays
            await new Promise(resolve => setTimeout(resolve, delay));
            
            return await callListAndWait(callListArgs, retryCount + 1);
        }
        
        console.error(`[OraclePusher] Error in callListAndWait:`, errorMessage);
        throw error;
    }
}

async function pushAssetPrices(assets, prices) {
    try {
        console.log(`[OraclePusher] Preparing to push ${assets.length} asset prices...`);
        
        // Log the assets and prices being pushed
        for (let i = 0; i < assets.length; i++) {
            console.log(`[OraclePusher] ${assets[i]} → ${prices[i]} (${(prices[i] / 1e8).toFixed(8)} USD)`);
        }

        // Build STRATO transaction call list
        const callListArgs = assets.map((asset, index) => ({
            contract: { address: process.env.PRICE_ORACLE_ADDRESS, name: "PriceOracle" },
            method: "setAssetPrice",
            args: {
                asset: asset,
                price: prices[index],
            },
        }));

        // Submit transaction to STRATO
        const result = await callListAndWait(callListArgs);



        // Check if the transaction was successful
        if (result.status !== "Success") {
            throw new Error(`Transaction failed with status: ${result.status}. Transaction hash: ${result.hash}`);
        }

        console.log(`[OraclePusher] Transaction completed → TX: ${result.hash}`);

        return {
            txHash: result.hash,
            status: result.status,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error(`[OraclePusher] Error pushing prices:`, error.message);
        throw error;
    }
}

// Wait for transaction confirmation
async function waitForTransaction(txHash, timeout = 60000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        try {
            const accessToken = await oauthClient.getAccessToken();
            
            const response = await axios.get(
                `${process.env.STRATO_NODE_URL}/bloc/v2.2/transactions/${txHash}/result`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );



            if (response.data && response.data.status && response.data.status !== "Pending") {
                return response.data;
            }
            
            // Wait 2 seconds before checking again
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`[OraclePusher] Error checking transaction status:`, error.response?.data || error.message);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    throw new Error(`Transaction ${txHash} did not confirm within ${timeout}ms`);
}

async function getAssetPrice(assetAddress) {
    try {
        const accessToken = await oauthClient.getAccessToken();
        
        // Query STRATO contract state using the correct API endpoint
        const response = await axios.get(
            `${process.env.STRATO_NODE_URL}/bloc/v2.2/contracts/PriceOracle/${process.env.PRICE_ORACLE_ADDRESS}/state`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        if (response.data && response.data.assetPrices && response.data.assetPrices[assetAddress]) {
            return response.data.assetPrices[assetAddress].toString();
        } else {
            throw new Error(`No price found for asset: ${assetAddress}`);
        }
    } catch (error) {
        console.error(`[OraclePusher] Error getting asset price:`, error.message);
        throw error;
    }
}

module.exports = { pushAssetPrices, getAssetPrice };
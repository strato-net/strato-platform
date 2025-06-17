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

async function pushAssetPrices(assets, prices) {
    try {
        console.log(`[OraclePusher] Preparing to push ${assets.length} asset prices...`);
        
        // Log the assets and prices being pushed
        for (let i = 0; i < assets.length; i++) {
            console.log(`[OraclePusher] ${assets[i]} → ${prices[i]} (${(prices[i] / 1e8).toFixed(8)} USD)`);
        }

        // Build STRATO transaction
        const tx = buildFunctionTx({
            contractName: process.env.ORACLE_CONTRACT_NAME || 'PriceOracle',
            contractAddress: process.env.PRICE_ORACLE_ADDRESS,
            method: 'setAssetPrices',
            args: {
                assets: assets,
                prices: prices
            }
        });

        console.log(`[OraclePusher] Submitting STRATO transaction...`);
        
        // Get fresh access token
        const accessToken = await oauthClient.getAccessToken();
        
        // Submit transaction to STRATO
        const response = await axios.post(
            `${process.env.STRATO_NODE_URL}/transaction/parallel?resolve=true`,
            tx,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        if (response.status !== 200) {
            throw new Error(`STRATO error: ${response.statusText}`);
        }

        if (!response.data || !Array.isArray(response.data)) {
            throw new Error("STRATO response data is empty or invalid");
        }

        const result = response.data[0];
        if (!result || !result.hash) {
            throw new Error("Missing transaction result or hash");
        }

        const txHash = result.hash;
        console.log(`[OraclePusher] Transaction submitted → TX: ${txHash}`);

        // Wait for transaction confirmation
        const finalResult = await waitForTransaction(txHash);
        
        console.log(`[OraclePusher] TX confirmed → status: ${finalResult.status}, hash: ${finalResult.hash}`);
        
        return {
            txHash: finalResult.hash,
            status: finalResult.status,
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
            
            const response = await axios.post(
                `${process.env.STRATO_NODE_URL}/transactions/results`,
                [txHash],
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            if (response.data && response.data.length > 0) {
                const result = response.data[0];
                if (result.status !== "Pending") {
                    return result;
                }
            }
            
            // Wait 2 seconds before checking again
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`[OraclePusher] Error checking transaction status:`, error.message);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    throw new Error(`Transaction ${txHash} did not confirm within ${timeout}ms`);
}

async function getAssetPrice(assetAddress) {
    try {
        const accessToken = await oauthClient.getAccessToken();
        
        // Query STRATO contract state
        const response = await axios.get(
            `${process.env.STRATO_NODE_URL}/contracts/state/${process.env.PRICE_ORACLE_ADDRESS}/state`,
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
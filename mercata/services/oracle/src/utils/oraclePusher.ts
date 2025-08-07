import axios from 'axios';
import { oauthClient } from './oauth';
import { logError } from './logger';
import { TransactionResult, CallListArg } from '../types';

const DEFAULT_GAS_PARAMS = {
    gasLimit: 32_100_000_000,
    gasPrice: 10,
};

const TIMEOUTS = {
    TRANSACTION_SUBMIT: 30000,
    TRANSACTION_WAIT: 120000,
    STATUS_CHECK: 10000,
};

const RETRY_DELAYS = {
    INITIAL: 2000,
    INCREMENT: 3000,
    STATUS_CHECK: 2000,
};

const MAX_RETRIES = 3;

// Create cirrus client like backend
const createCirrusClient = () => {
    const baseURL = `${process.env.STRATO_NODE_URL}/cirrus/search`;
    return axios.create({
        baseURL,
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        timeout: 60_000,
    });
};

// Function to read round duration from contract using cirrus
export async function getRoundDuration(): Promise<number> {
    try {
        const accessToken = await oauthClient().getAccessToken();
        const cirrus = createCirrusClient();
        
        const response = await cirrus.get(`/BlockApps-Mercata-PriceOracle`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            params: {
                address: `eq.${process.env.PRICE_ORACLE_ADDRESS}`,
                select: "roundDuration"
            }
        });

        const roundDuration = response.data?.[0]?.roundDuration;
        if (roundDuration && typeof roundDuration === 'number') {
            return roundDuration;
        }
        
        // Fallback to default 15 minutes (900 seconds)
        return 900;
    } catch (error) {
        logError('OraclePusher', new Error(`Error reading round duration: ${error}`));
        // Fallback to default 15 minutes (900 seconds)
        return 900;
    }
}

async function callListAndWait(callListArgs: CallListArg[], retryCount: number = 0): Promise<TransactionResult> {
    try {
        const accessToken = await oauthClient().getAccessToken();
        
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
                timeout: TIMEOUTS.TRANSACTION_SUBMIT
            }
        );

        const txHash = extractTransactionHash(response.data);

        return await waitForTransaction(txHash);
    } catch (error: any) {
        const errorMessage = error.message;
        
        if (errorMessage.includes('Rejected from mempool') && retryCount < MAX_RETRIES) {
            const delay = RETRY_DELAYS.INITIAL + (retryCount * RETRY_DELAYS.INCREMENT);
            await new Promise(resolve => setTimeout(resolve, delay));
            return await callListAndWait(callListArgs, retryCount + 1);
        }
        
        logError('OraclePusher', new Error(`Error in callListAndWait: ${errorMessage}`));
        throw error;
    }
}

function extractTransactionHash(data: any): string {
    if (Array.isArray(data) && data.length > 0) {
        return data[0].hash || data[0];
    } else if (data && data.hash) {
        return data.hash;
    } else if (typeof data === 'string') {
        return data;
    }
    throw new Error('No transaction hash returned from STRATO');
}

export async function pushAssetPrices(assets: string[], prices: number[]): Promise<TransactionResult> {
    try {
        const callListArgs: CallListArg[] = [{
            contract: { address: process.env.PRICE_ORACLE_ADDRESS!, name: "PriceOracle" },
            method: "submitPrices",
            args: { assets, priceValues: prices },
        }];

        const result = await callListAndWait(callListArgs);

        if (result.status !== "Success") {
            throw new Error(`Transaction failed with status: ${result.status}. Transaction hash: ${result.hash}`);
        }

        return result;
    } catch (error: any) {
        logError('OraclePusher', new Error(`Error pushing prices: ${error.message}`));
        throw error;
    }
}

async function waitForTransaction(txHash: string): Promise<TransactionResult> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < TIMEOUTS.TRANSACTION_WAIT) {
        try {
            const accessToken = await oauthClient().getAccessToken();
            
            const response = await axios.post(
                `${process.env.STRATO_NODE_URL}/bloc/v2.2/transactions/results`,
                [txHash],
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: TIMEOUTS.STATUS_CHECK
                }
            );

            const txData = response.data[0];
            
            if (txData.status === "Success") {
                return {
                    status: "Success",
                    hash: txHash,
                    timestamp: Date.now().toString()
                };
            } else if (txData.status === "Failed" || txData.status === "Failure") {
                const errorMessage = txData.txResult?.message || txData.error || 'Unknown error';
                throw new Error(`Transaction failed: ${errorMessage}`);
            } else if (txData.status === "Pending") {
                // Wait and check again
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS.STATUS_CHECK));
                continue;
            }
            
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS.STATUS_CHECK));
            
        } catch (error: any) {
            if (error.message.includes('Transaction failed')) {
                throw error;
            }
            
            logError('OraclePusher', new Error(`Error checking transaction status: ${error.message}`));
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS.STATUS_CHECK));
        }
    }
    
    throw new Error(`Transaction timeout after ${TIMEOUTS.TRANSACTION_WAIT}ms`);
} 
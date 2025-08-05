import axios from 'axios';
import { oauthClient } from './oauth';
import { logError } from './logger';
import { TransactionResult, CallListArg } from '../types';

// Constants
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
        const errorMessage = error.response?.data?.message || error.message;
        const statusCode = error.response?.status;
        
        if (errorMessage.includes('Rejected from mempool') && retryCount < MAX_RETRIES) {
            const delay = RETRY_DELAYS.INITIAL + (retryCount * RETRY_DELAYS.INCREMENT);
            await new Promise(resolve => setTimeout(resolve, delay));
            return await callListAndWait(callListArgs, retryCount + 1);
        }
        
        logError('OraclePusher', new Error(`Error in callListAndWait (HTTP ${statusCode}): ${errorMessage}`));
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
        const callListArgs: CallListArg[] = assets.map((asset, index) => ({
            contract: { address: process.env.PRICE_ORACLE_ADDRESS!, name: "PriceOracle" },
            method: "setAssetPrice",
            args: { asset, price: prices[index] },
        }));

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
            
            const response = await axios.get(
                `${process.env.STRATO_NODE_URL}/bloc/v2.2/transactions/${txHash}/result`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: TIMEOUTS.STATUS_CHECK
                }
            );

            if (response.data?.status && response.data.status !== "Pending") {
                return response.data;
            }
            
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS.STATUS_CHECK));
        } catch (error: any) {
            logError('OraclePusher', new Error(`Error checking transaction status: ${error.response?.data || error.message}`));
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS.STATUS_CHECK));
        }
    }
    
    throw new Error(`Transaction ${txHash} did not confirm within ${TIMEOUTS.TRANSACTION_WAIT}ms`);
} 
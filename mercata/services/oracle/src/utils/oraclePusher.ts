import axios from 'axios';
import { oauthClient } from './oauth';
import { logError, logInfo } from './logger';
import { TransactionResult, CallListArg } from '../types';

const GAS_PARAMS = { gasLimit: 32_100_000_000, gasPrice: 10 };
const TIMEOUTS = { SUBMIT: 30000, WAIT: 120000, STATUS: 10000 };
const RETRY_DELAYS = { INITIAL: 2000, INCREMENT: 3000, STATUS: 2000 };
const MAX_RETRIES = 3;

export async function getUpdateInterval(): Promise<number> {
    const minutes = parseInt(process.env.UPDATE_INTERVAL_MINUTES || '15');
    if (minutes < 1 || minutes > 60) {
        throw new Error(`Invalid UPDATE_INTERVAL_MINUTES: ${minutes}. Must be 1-60.`);
    }
    return minutes * 60;
}

async function isPrimaryHealthy(): Promise<boolean> {
    const primaryUrl = process.env.PRIMARY_ORACLE_URL;
    if (!primaryUrl) return false;
    
    try {
        const response = await axios.get(`${primaryUrl}/health`, { timeout: 5000 });
        return response.status === 200;
    } catch {
        return false;
    }
}

export async function shouldSubmitPrices(): Promise<boolean> {
    const primaryUrl = process.env.PRIMARY_ORACLE_URL;
    if (!primaryUrl) return true;
    
    const primaryHealthy = await isPrimaryHealthy();
    if (!primaryHealthy) {
        logInfo('OraclePusher', 'Primary down, taking over');
        return true;
    } else {
        logInfo('OraclePusher', 'Primary healthy, skipping');
        return false;
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
                txParams: GAS_PARAMS
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: TIMEOUTS.SUBMIT
            }
        );

        const txHash = extractTransactionHash(response.data);
        return await waitForTransaction(txHash);
    } catch (error: any) {
        if (error.message.includes('Rejected from mempool') && retryCount < MAX_RETRIES) {
            const delay = RETRY_DELAYS.INITIAL + (retryCount * RETRY_DELAYS.INCREMENT);
            await new Promise(resolve => setTimeout(resolve, delay));
            return await callListAndWait(callListArgs, retryCount + 1);
        }
        
        logError('OraclePusher', new Error(`Error in callListAndWait: ${error.message}`));
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
    const shouldSubmit = await shouldSubmitPrices();
    
    if (!shouldSubmit) {
        logInfo('OraclePusher', 'Skipping submission (primary healthy)');
        return { status: "Success", hash: "monitor-skip", timestamp: Date.now().toString() };
    }
    
    try {
        logInfo('OraclePusher', 'Submitting prices');
        
        const callListArgs: CallListArg[] = [{
            contract: { address: process.env.PRICE_ORACLE_ADDRESS!, name: "PriceOracle" },
            method: "setAssetPrices",
            args: { assets, priceValues: prices },
        }];

        const result = await callListAndWait(callListArgs);
        if (result.status !== "Success") {
            throw new Error(`Transaction failed: ${result.status}. Hash: ${result.hash}`);
        }

        logInfo('OraclePusher', 'Submission successful');
        return result;
    } catch (error: any) {
        logError('OraclePusher', new Error(`Error pushing prices: ${error.message}`));
        throw error;
    }
}

async function waitForTransaction(txHash: string): Promise<TransactionResult> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < TIMEOUTS.WAIT) {
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
                    timeout: TIMEOUTS.STATUS
                }
            );

            const txData = response.data[0];
            
            if (txData.status === "Success") {
                return { status: "Success", hash: txHash, timestamp: Date.now().toString() };
            } else if (txData.status === "Failed" || txData.status === "Failure") {
                const errorMessage = txData.txResult?.message || txData.error || 'Unknown error';
                throw new Error(`Transaction failed: ${errorMessage}`);
            } else if (txData.status === "Pending") {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS.STATUS));
                continue;
            }
            
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS.STATUS));
            
        } catch (error: any) {
            if (error.message.includes('Transaction failed')) {
                throw error;
            }
            
            logError('OraclePusher', new Error(`Error checking status: ${error.message}`));
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS.STATUS));
        }
    }
    
    throw new Error(`Transaction timeout after ${TIMEOUTS.WAIT}ms`);
} 
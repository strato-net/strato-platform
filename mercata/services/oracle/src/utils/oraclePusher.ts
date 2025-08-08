import { apiPost } from './apiClient';
import { oauthClient } from './oauth';
import { logError, logInfo } from './logger';
import { TransactionResult, CallListArg } from '../types';
import { checkUSDSTBalance } from './balanceChecker';
import { GAS_PARAMS, TIMEOUTS, RETRY_DELAYS } from './constants';

export async function getUpdateInterval(): Promise<number> {
    const minutes = parseInt(process.env.UPDATE_INTERVAL_MINUTES || '15');
    if (minutes < 1 || minutes > 60) {
        throw new Error(`Invalid UPDATE_INTERVAL_MINUTES: ${minutes}. Must be 1-60.`);
    }
    return minutes * 60;
}

async function callListAndWait(callListArgs: CallListArg[]): Promise<TransactionResult> {
    const accessToken = await oauthClient().getAccessToken();
    
    const response = await apiPost(
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
        },
        { logPrefix: 'OraclePusher' }
    );

    const txHash = extractTransactionHash(response.data);
    return await waitForTransaction(txHash);
}

function extractTransactionHash(data: any): string {
    if (!data) {
        throw new Error('No transaction data returned from STRATO');
    }
    
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
    logInfo('OraclePusher', 'Submitting prices');
    
    // Check USDST balance before submitting
    await checkUSDSTBalance();
    
    const callListArgs: CallListArg[] = [{
        contract: { address: process.env.PRICE_ORACLE_ADDRESS!, name: "PriceOracle" },
        method: "setAssetPrices",
        args: { assets, priceValues: prices },
    }];

    const result = await callListAndWait(callListArgs);
    logInfo('OraclePusher', 'Submission successful');
    return result;
}

async function waitForTransaction(txHash: string): Promise<TransactionResult> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < TIMEOUTS.WAIT) {
        try {
            const accessToken = await oauthClient().getAccessToken();
            
            const response = await apiPost(
                `${process.env.STRATO_NODE_URL}/bloc/v2.2/transactions/results`,
                [txHash],
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: TIMEOUTS.STATUS
                },
                { logPrefix: 'OraclePusher' }
            );

            const txData = response.data[0];
            
            if (!txData) {
                throw new Error('No transaction data returned from STRATO');
            }
            
            if (txData.status === "Success") {
                return { status: "Success", hash: txHash, timestamp: Date.now().toString() };
            } else if (txData.status === "Failed" || txData.status === "Failure") {
                const errorMessage = txData.txResult?.message || txData.error || 'Unknown error';
                throw new Error(`Transaction failed: ${errorMessage}`);
            } else if (txData.status === "Pending") {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS.STATUS));
                continue;
            }
            
            // If status is not Success, Failed, Failure, or Pending, wait and retry
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS.STATUS));
            
        } catch (error: any) {
            if (error.message.includes('Transaction failed')) {
                throw error;
            }
            
            // Log and continue retrying for other errors
            logError('OraclePusher', new Error(`Error checking status: ${error.message}`));
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS.STATUS));
        }
    }
    
    throw new Error(`Transaction timeout after ${TIMEOUTS.WAIT}ms`);
} 
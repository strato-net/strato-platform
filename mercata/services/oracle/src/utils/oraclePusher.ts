import { apiPost } from './apiClient';
import { oauthClient } from './oauth';
import { logError, logInfo } from './logger';
import { TransactionResult, CallListArg } from '../types';
import { checkBalances } from './balanceChecker';
import { GAS_PARAMS, TIMEOUTS, RETRY_DELAYS } from './constants';
import { txMetricsService } from './txMetricsService';


async function callListAndWait(callListArgs: CallListArg[]): Promise<TransactionResult> {
    const accessToken = await oauthClient().getAccessToken();
    const submitTime = Date.now();
    
    const response = await apiPost(
        `${process.env.STRATO_NODE_URL}/bloc/v2.2/transaction/parallel?resolve=true`,
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

    // Evaluate immediate status from resolve=true; fallback to polling on Pending or undefined
    const getImmediateResult = (data: unknown): TransactionResult | undefined => {
        const first: any = Array.isArray(data) ? (data as any[])[0] : data;
        const status: string | undefined = first?.status;

        switch (status) {
            case 'Success':
                return { status: 'Success', hash: txHash, timestamp: Date.now().toString() };
            case 'Failed':
            case 'Failure': {
                const errorMessage = first?.txResult?.message ?? first?.error ?? 'Unknown error';
                throw new Error(`Transaction failed: ${errorMessage}`);
            }
            case 'Pending':
            case undefined:
            default:
                // Pending, undefined, or any unknown status: fall back to polling
                return undefined;
        }
    };

    const immediate = getImmediateResult(response.data);
    const result = immediate ?? await waitForTransaction(txHash);
    
    // Record metrics (errors are handled inside txMetricsService)
    await txMetricsService.recordTxMetric({
        txHash,
        duration: Date.now() - submitTime,
        status: result.status,
    });
    
    return result;
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
    
    // Check balances before submitting
    await checkBalances();
    
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

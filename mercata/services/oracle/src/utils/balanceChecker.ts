import { apiGet } from './apiClient';
import { oauthClient } from './oauth';
import { logError } from './logger';
import { healthMonitor } from './healthMonitor';
import { CONSTANTS } from './constants';

async function fetchUSDSTBalance(): Promise<bigint> {
    const accessToken = await oauthClient().getAccessToken();
    const userAddr = await oauthClient().getUserAddress();

    const response = await apiGet(
        `${process.env.STRATO_NODE_URL}/cirrus/search/BlockApps-Mercata-Token-_balances`,
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            params: {
                address: `eq.${CONSTANTS.USDST_ADDRESS}`,
                key: `eq.${userAddr}`,
                select: 'balance:value::text'
            },
            timeout: 10000
        },
        { logPrefix: 'BalanceChecker' }
    );

    return BigInt(response.data[0]?.balance || '0');
}

/**
 * Checks USDST balance and marks service unhealthy if below threshold
 * @throws {Error} If balance is critically low (below gas fee)
 */
export async function checkUSDSTBalance(): Promise<void> {
    const balance = await fetchUSDSTBalance();
    const balanceUSD = Number(balance) / 1e18;
    
    if (balance < CONSTANTS.GAS_FEE_USDST) {
        const gasFeeUSD = Number(CONSTANTS.GAS_FEE_USDST) / 1e18;
        const error = `USDST balance is critically low (less than ${gasFeeUSD} USDST gas fee)`;
        healthMonitor.recordFailure(error);
        logError('BalanceChecker', new Error(error));
        process.exit(1); // Stop the service immediately
    }
    
    if (balance < CONSTANTS.MIN_USDST_BALANCE) {
        const error = `Low USDST balance: ${balanceUSD} USDST (minimum: 10 USDST). Service will continue but may fail on next transaction.`;
        healthMonitor.recordFailure(error);
        logError('BalanceChecker', new Error(error));
    }
}

import { apiGet } from './apiClient';
import { oauthClient } from './oauth';
import { logError } from './logger';
import { CONSTANTS } from './constants';

async function fetchVoucherBalance(): Promise<bigint> {
    const accessToken = await oauthClient().getAccessToken();
    const userAddr = await oauthClient().getUserAddress();

    const voucherEndpoint = `${process.env.STRATO_NODE_URL}/cirrus/search/BlockApps-Voucher-_balances`;
    const response = await apiGet(
        voucherEndpoint,
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            params: {
                key: `eq.${userAddr}`,
                select: 'balance:value::text'
            },
            timeout: 10000
        },
        {
            logPrefix: 'BalanceChecker',
            apiUrl: voucherEndpoint,
            method: 'GET'
        }
    );

    return BigInt(response.data[0]?.balance || '0');
}

async function fetchUSDSTBalance(): Promise<bigint> {
    const accessToken = await oauthClient().getAccessToken();
    const userAddr = await oauthClient().getUserAddress();

    const tokenEndpoint = `${process.env.STRATO_NODE_URL}/cirrus/search/BlockApps-Token-_balances`;
    const response = await apiGet(
        tokenEndpoint,
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
        {
            logPrefix: 'BalanceChecker',
            apiUrl: tokenEndpoint,
            method: 'GET'
        }
    );

    return BigInt(response.data[0]?.balance || '0');
}

/**
 * Checks Voucher and USDST balance and marks service unhealthy if below threshold
 * @throws {Error} If total transactions possible are below threshold
 */
export async function checkBalances(): Promise<void> {
    const [voucherBalance, usdstBalance] = await Promise.all([
        fetchVoucherBalance(),
        fetchUSDSTBalance()
    ]);
    
    // Calculate total possible transactions using both balances
    const voucherTransactions = voucherBalance / CONSTANTS.GAS_FEE_VOUCHER;
    const usdstTransactions = usdstBalance / CONSTANTS.GAS_FEE_USDST;
    const totalTransactions = voucherTransactions + usdstTransactions;
    
    const voucherBalanceUSD = Number(voucherBalance) / 1e18;
    const usdstBalanceUSD = Number(usdstBalance) / 1e18;
    
    // Check if total transactions are below minimum threshold
    if (totalTransactions < CONSTANTS.MIN_TRANSACTIONS_THRESHOLD) {
        const error = `Total possible transactions (${totalTransactions}) below minimum threshold (${CONSTANTS.MIN_TRANSACTIONS_THRESHOLD}). Voucher: ${voucherBalanceUSD} (${voucherTransactions} txs), USDST: ${usdstBalanceUSD} (${usdstTransactions} txs)`;
        logError('BalanceChecker', new Error(error));
        
        // Exit if critically low (less than 1 transaction possible)
        if (totalTransactions < BigInt(1)) {
            process.exit(1);
        }
    }
}

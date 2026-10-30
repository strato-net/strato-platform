import { apiGet, apiPost } from './apiClient';
import { oauthClient } from './oauth';
import { logError } from './logger';
import { CONSTANTS } from './constants';

const DECIDER_STATE = '0x00000000000000000000000000000000dec1de02';
const GET_IMPL_CONTRACT = '0x56557016'; // getImplContract()
const STRATO_FEE_QUOTE = '0x462d073f'; // stratoFeeQuote() -> (fee, priceVersion, valid)
const ACTIVATION_BLOCK = '0x80faa3d2'; // activationBlock(): legacy USDST fee before it

async function rpc(method: string, params: unknown[]): Promise<any> {
    const rpcEndpoint = `${process.env.STRATO_NODE_URL}/rpc`;
    const response = await apiPost(
        rpcEndpoint,
        { jsonrpc: '2.0', id: 1, method, params },
        { timeout: 10000 },
        { logPrefix: 'BalanceChecker', apiUrl: rpcEndpoint, method: 'POST' }
    );
    return response.data;
}

/** Returns the call's ABI words, or null when the contract has no such function. */
async function ethCall(to: string, data: string): Promise<bigint[] | null> {
    const res = await rpc('eth_call', [{ to, data }, 'latest']);
    if (res?.error) {
        if (/no function for selector/.test(res.error.message || '')) return null;
        throw new Error(`eth_call ${data} failed: ${res.error.message}`);
    }
    const hex = String(res.result || '').replace(/^0x/, '');
    return (hex.match(/.{64}/g) || []).map((w) => BigInt(`0x${w}`));
}

/** The installed fee router's STRATO charge per call, or null while the router still charges USDST. */
async function stratoFee(): Promise<{ fee: bigint; valid: boolean } | null> {
    const impl = await ethCall(DECIDER_STATE, GET_IMPL_CONTRACT);
    if (!impl?.length) return null;
    const router = `0x${impl[0].toString(16).padStart(40, '0')}`;
    const activation = await ethCall(router, ACTIVATION_BLOCK);
    if (activation?.length && activation[0] > BigInt((await rpc('eth_blockNumber', [])).result || '0')) return null;
    const words = await ethCall(router, STRATO_FEE_QUOTE);
    return words && words.length >= 3 ? { fee: words[0], valid: words[2] !== 0n } : null;
}

async function balanceOf(table: string, contract: string): Promise<bigint> {
    const accessToken = await oauthClient().getAccessToken();
    const userAddr = await oauthClient().getUserAddress();

    const endpoint = `${process.env.STRATO_NODE_URL}/cirrus/search/${table}`;
    const response = await apiGet(
        endpoint,
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            params: {
                address: `eq.${contract}`,
                key: `eq.${userAddr}`,
                select: 'balance:value::text'
            },
            timeout: 10000
        },
        {
            logPrefix: 'BalanceChecker',
            apiUrl: endpoint,
            method: 'GET'
        }
    );

    return BigInt(response.data[0]?.balance || '0');
}

/**
 * Checks how many contract calls the service account can still pay for (vouchers, then
 * STRATO, then USDST buying STRATO) and marks the service unhealthy below the threshold
 * @throws {Error} If total transactions possible are below threshold
 */
export async function checkBalances(): Promise<void> {
    const [quote, voucherBalance, usdstBalance, stratoBalance] = await Promise.all([
        stratoFee(),
        balanceOf('BlockApps-Voucher-_balances', CONSTANTS.VOUCHER_ADDRESS),
        balanceOf('BlockApps-Token-_balances', CONSTANTS.USDST_ADDRESS),
        CONSTANTS.STRATO_TOKEN_ADDRESS ? balanceOf('BlockApps-Token-_balances', CONSTANTS.STRATO_TOKEN_ADDRESS) : 0n,
    ]);

    // Calculate total possible transactions using all three. Under the STRATO router
    // USDST buys the missing STRATO at up to twice the call's value, and nothing while the router has no price.
    const voucherTransactions = voucherBalance / CONSTANTS.GAS_FEE_VOUCHER;
    const stratoTransactions = quote?.valid && quote.fee > 0n ? stratoBalance / quote.fee : 0n;
    const usdstTransactions = quote && !quote.valid ? 0n : usdstBalance / (quote ? CONSTANTS.GAS_FEE_USDST * 2n : CONSTANTS.GAS_FEE_USDST);
    const totalTransactions = voucherTransactions + stratoTransactions + usdstTransactions;

    const stratoBalanceUnits = Number(stratoBalance) / 1e18;
    const usdstBalanceUSD = Number(usdstBalance) / 1e18;

    // Check if total transactions are below minimum threshold
    if (totalTransactions <= CONSTANTS.MIN_TRANSACTIONS_THRESHOLD) {
        const error = `Total possible transactions (${totalTransactions}) below minimum threshold (${CONSTANTS.MIN_TRANSACTIONS_THRESHOLD}). Vouchers: ${voucherTransactions}, STRATO: ${stratoBalanceUnits} (${stratoTransactions} txs), USDST: ${usdstBalanceUSD} (${usdstTransactions} txs)`;
        logError('BalanceChecker', new Error(error));

        // Exit if critically low (less than 1 transaction possible)
        if (totalTransactions < BigInt(1)) {
            process.exit(1);
        }
    }
}

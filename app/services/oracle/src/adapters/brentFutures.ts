import { BrentContract } from '../types';
import { apiGet } from '../utils/apiClient';
import { ICE_BRENT } from '../utils/constants';
import { logWarning } from '../utils/logger';

const londonHour = new Intl.DateTimeFormat('en-GB', {
    timeZone: ICE_BRENT.TIME_ZONE,
    hour: '2-digit',
    hourCycle: 'h23'
});

export function parseBrentExpiryCalendar(csv: string): BrentContract[] {
    const lines = csv.trim().replace(/^\uFEFF/, '').split(/\r?\n/);
    if (!lines.shift()?.startsWith('"CONTRACT SYMBOL","FTD","LTD",')) {
        throw new Error('Invalid ICE Brent expiry calendar header');
    }

    const contracts = lines.filter(line => line.trim()).map(line => {
        const match = /^"(?:="")?([A-Z][a-z]{2})(\d{2})(?:"")?","[^"]*","(\d{1,2})\/(\d{1,2})\/(\d{4})"(?:,|$)/.exec(line);
        if (!match || !ICE_BRENT.MONTH_CODES[match[1]]) {
            throw new Error('Invalid ICE Brent expiry calendar row');
        }

        const [, month, year, expiryMonth, expiryDay, expiryYear] = match;
        const date = `${expiryYear}-${expiryMonth.padStart(2, '0')}-${expiryDay.padStart(2, '0')}`;
        const utcTime = Date.UTC(Number(expiryYear), Number(expiryMonth) - 1, Number(expiryDay), ICE_BRENT.EXPIRY_HOUR, ICE_BRENT.EXPIRY_MINUTE);
        const deliveryMonth = new Date(Date.UTC(Number(expiryYear), Number(expiryMonth) + 1, 1));
        if (new Date(utcTime).toISOString().slice(0, 10) !== date ||
            Object.keys(ICE_BRENT.MONTH_CODES)[deliveryMonth.getUTCMonth()] !== month ||
            String(deliveryMonth.getUTCFullYear()).slice(-2) !== year) {
            throw new Error('Invalid ICE Brent contract or last trading date');
        }

        const londonOffset = Number(londonHour.format(utcTime)) - ICE_BRENT.EXPIRY_HOUR;
        return {
            symbol: `BRN${ICE_BRENT.MONTH_CODES[month]}${year}`,
            expiresAt: utcTime - londonOffset * 60 * 60 * 1000
        };
    }).sort((a, b) => a.expiresAt - b.expiresAt);

    if (contracts.length === 0 || new Set(contracts.map(contract => contract.symbol)).size !== contracts.length) {
        throw new Error('Empty or duplicate ICE Brent expiry calendar');
    }
    return contracts;
}

export function selectBrentContract(contracts: BrentContract[], asOf: number): BrentContract {
    const contract = contracts.find(candidate => candidate.expiresAt > asOf);
    if (!Number.isFinite(asOf) || !contract) {
        throw new Error('ICE Brent expiry calendar has no unexpired contract');
    }
    return contract;
}

let cachedContracts: BrentContract[] = [];
let fetchedAt = 0;
let refreshAfter = 0;
let refreshInFlight: Promise<void> | undefined;

export async function getBrentFrontMonth(asOf: number): Promise<BrentContract> {
    if (Date.now() >= refreshAfter) {
        if (!refreshInFlight) {
            refreshInFlight = apiGet<string>(ICE_BRENT.CALENDAR_URL, {
                responseType: 'text',
                timeout: ICE_BRENT.CALENDAR_TIMEOUT_MS
            }, { logPrefix: 'ICEBrentCalendar' }).then(response => {
                const contracts = parseBrentExpiryCalendar(response.data);
                selectBrentContract(contracts, Date.now());
                cachedContracts = contracts;
                fetchedAt = Date.now();
                refreshAfter = fetchedAt + ICE_BRENT.CALENDAR_REFRESH_MS;
            }).catch(error => {
                refreshAfter = Date.now() + ICE_BRENT.CALENDAR_RETRY_MS;
                if (cachedContracts.length === 0 || Date.now() - fetchedAt > ICE_BRENT.CALENDAR_MAX_AGE_MS) {
                    throw error;
                }
                logWarning('ICEBrentCalendar', 'Could not refresh the expiry calendar; using the cached ICE dates');
            }).finally(() => {
                refreshInFlight = undefined;
            });
        }
        await refreshInFlight;
    }

    if (cachedContracts.length === 0 || Date.now() - fetchedAt > ICE_BRENT.CALENDAR_MAX_AGE_MS) {
        throw new Error('No current ICE Brent expiry calendar available');
    }
    return selectBrentContract(cachedContracts, asOf);
}

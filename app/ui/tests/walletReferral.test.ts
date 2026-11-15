// The wallet referral confirmation of src/lib/attribution.ts, against a
// stand-in browser: when the wallet is prompted, what is sent, and what is
// remembered. Run with `node --experimental-strip-types --test tests/`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { claimWalletReferral } from '../src/lib/attribution.ts';

const WALLET = '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ADDRESS = WALLET.slice(2).toLowerCase();
const SIGNATURE = `0x${'ab'.repeat(65)}`;

type Call = { method: string; url: string; wallet: string; body?: unknown };

/** A fresh browser: its cookies, its localStorage, and a backend that answers the claim routes. */
const browser = (cookie: string, offer: { status?: number; message?: string | null }, claimStatus = 200) => {
  const cookies = new Map(cookie ? [cookie.split('=') as [string, string]] : []);
  const storage = new Map<string, string>();
  const calls: Call[] = [];
  Object.assign(globalThis, {
    window: { location: { protocol: 'https:' } },
    document: {
      get cookie() {
        return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
      },
      set cookie(assignment: string) {
        const [name, value] = assignment.split(';')[0].split('=');
        cookies.set(name, value);
      },
    },
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) },
    fetch: async (url: string, init: { method?: string; headers: Record<string, string>; body?: string } = { headers: {} }) => {
      const method = init.method ?? 'GET';
      calls.push({ method, url, wallet: init.headers['X-Wallet-Address'], ...(init.body ? { body: JSON.parse(init.body) } : {}) });
      const status = method === 'GET' ? (offer.status ?? 200) : claimStatus;
      return { ok: status < 300, json: async () => (method === 'GET' ? { message: offer.message, issuedAt: 'T' } : { recorded: true }) };
    },
  });
  return { calls, cookies, storage };
};

const signer = (result: string | Error = SIGNATURE) => {
  const asked: string[] = [];
  const sign = async (message: string) => {
    asked.push(message);
    if (result instanceof Error) throw result;
    return result;
  };
  return { asked, sign };
};

test('without a ref cookie nothing is asked', async () => {
  const { calls } = browser('', { message: 'sign me' });
  const { asked, sign } = signer();
  await claimWalletReferral(WALLET, sign);
  assert.deepEqual([calls, asked], [[], []]);
});

test('a wallet confirms once: the server text is signed as given, and the pair is settled', async () => {
  const { calls, storage, cookies } = browser('ref=abcdefghjk', { message: 'sign me' });
  const { asked, sign } = signer();
  await claimWalletReferral(WALLET, sign);
  assert.deepEqual(asked, ['sign me']);
  assert.deepEqual(calls, [
    { method: 'GET', url: '/api/refer/partner-claim?code=ABCDEFGHJK', wallet: ADDRESS },
    { method: 'POST', url: '/api/refer/partner-claim', wallet: ADDRESS, body: { code: 'ABCDEFGHJK', issuedAt: 'T', signature: SIGNATURE } },
  ]);
  assert.equal(storage.get('ref_claimed'), JSON.stringify([`ABCDEFGHJK:${ADDRESS}`]));
  // The ref cookie stays: a later signup from this browser counts for the code too
  assert.equal(cookies.get('ref'), 'abcdefghjk');
  await claimWalletReferral(WALLET, sign);
  assert.equal(calls.length, 2);
});

test('nothing to confirm: no prompt, and never asked about again', async () => {
  const { calls } = browser('ref=producthunt', { message: null });
  const { asked, sign } = signer();
  await claimWalletReferral(WALLET, sign);
  await claimWalletReferral(WALLET, sign);
  assert.deepEqual([asked, calls.map((c) => c.method)], [[], ['GET']]);
});

test('referrals unavailable: no prompt now, asked again later', async () => {
  const { calls, storage } = browser('ref=ABCDEFGHJK', { status: 503 });
  const { asked, sign } = signer();
  await claimWalletReferral(WALLET, sign);
  await claimWalletReferral(WALLET, sign);
  assert.deepEqual([asked, calls.map((c) => c.method), storage.size], [[], ['GET', 'GET'], 0]);
});

test('a declined prompt is not repeated in this browser session, for that wallet only', async () => {
  const { calls, storage } = browser('ref=ABCDEFGHJK', { message: 'sign me' });
  const declined = signer(new Error('User rejected the request'));
  await claimWalletReferral(WALLET, declined.sign);
  await claimWalletReferral(WALLET, declined.sign);
  assert.deepEqual([declined.asked.length, calls.map((c) => c.method), storage.size], [1, ['GET'], 0]);
  const other = signer();
  await claimWalletReferral(`0x${'12'.repeat(20)}`, other.sign);
  assert.equal(other.asked.length, 1);
});

test('a contract wallet, whose signature is not 65 bytes, is settled without a claim', async () => {
  const { calls } = browser('ref=ABCDEFGHJK', { message: 'sign me' });
  const { asked, sign } = signer(`0x${'ab'.repeat(300)}`);
  await claimWalletReferral(WALLET, sign);
  await claimWalletReferral(WALLET, sign);
  assert.deepEqual([asked.length, calls.map((c) => c.method)], [1, ['GET']]);
});

test('a claim the backend does not take is not settled, and not prompted again this session', async () => {
  const { calls, storage } = browser('ref=ABCDEFGHJK', { message: 'sign me' }, 503);
  const { asked, sign } = signer();
  await claimWalletReferral(WALLET, sign);
  await claimWalletReferral(WALLET, sign);
  assert.deepEqual([asked.length, calls.map((c) => c.method), storage.size], [1, ['GET', 'POST'], 0]);
});

test('two calls at once prompt once', async () => {
  const { calls } = browser('ref=ABCDEFGHJK', { message: 'sign me' });
  const { asked, sign } = signer();
  await Promise.all([claimWalletReferral(WALLET, sign), claimWalletReferral(WALLET, sign)]);
  assert.deepEqual([asked.length, calls.length], [1, 2]);
});

test('a wallet another tab prompted while the offer was fetched is not prompted again', async () => {
  const { calls } = browser('ref=ABCDEFGHJK', { message: 'sign me' });
  const answer = globalThis.fetch;
  globalThis.fetch = ((...request: Parameters<typeof fetch>) => {
    document.cookie = `ref_asked=${ADDRESS}`;
    return answer(...request);
  }) as typeof fetch;
  const { asked, sign } = signer();
  await claimWalletReferral(WALLET, sign);
  assert.deepEqual([asked, calls.map((c) => c.method)], [[], ['GET']]);
});

test("one wallet's open prompt does not hold back another wallet", async () => {
  browser('ref=ABCDEFGHJK', { message: 'sign me' });
  let prompts = 0;
  void claimWalletReferral(`0x${'34'.repeat(20)}`, () => {
    prompts++;
    return new Promise<string>(() => {});
  });
  const other = signer();
  await claimWalletReferral(`0x${'12'.repeat(20)}`, other.sign);
  assert.deepEqual([prompts, other.asked.length], [1, 1]);
});

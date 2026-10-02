/**
 * Is the relayer able to drive BOTH the old bridge path and the solver fast
 * path on helium?
 *
 * Two different gates, which is the thing that makes this confusing:
 *   - `onlyOwner` methods (MercataBridge deposits, recordWithdrawalClaim,
 *     rejectAnnouncement) reach the relayer through an AdminRegistry WHITELIST
 *     entry per (target, function, user). Missing one is silent until the
 *     relayer tries the call and the vote sits unresolved.
 *   - `onlyBridgeOperator` methods (the whole native relayer surface) are a
 *     direct address comparison against `bridgeOperator`. No whitelist can
 *     help; the address itself has to be right.
 *
 *   node deploy/relayer-readiness.js
 */
const fs = require('fs');
const dotenv = require('dotenv');
const axios = require('axios');
const backendEnv = dotenv.parse(fs.readFileSync('/Users/dustinnorwood/BlockApps/strato-platform/app/backend/.env'));
const NODE = process.env.NODE_URL || 'https://node1.testnet.strato.nexus';
const RELAYER = '72b572ed77397da1ece4768cb2fec1943e1af7cb';
const BRIDGES = {
  '0000000000000000000000000000000000001008': 'MercataBridge',
  '49f69252b00235030a4dcd4c7ef17a64ef346258': 'StratoNativeBridge',
};
(async () => {
  const url = backendEnv.OAUTH_DISCOVERY_URL.replace('/.well-known/openid-configuration', '/protocol/openid-connect/token');
  const { data: t } = await axios.post(url, new URLSearchParams({
    grant_type: 'password', client_id: backendEnv.OAUTH_CLIENT_ID,
    client_secret: backendEnv.OAUTH_CLIENT_SECRET,
    username: backendEnv.USERNAME, password: backendEnv.PASSWORD,
  }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const H = { Authorization: `Bearer ${t.access_token}` };

  const { data: nb } = await axios.get(`${NODE}/bloc/v2.2/contracts/StratoNativeBridge/49f69252b00235030a4dcd4c7ef17a64ef346258/state`, { headers: H });
  console.log(`bridgeOperator now: ${nb.bridgeOperator}`);
  console.log(`relayer restored  : ${nb.bridgeOperator === RELAYER ? 'YES' : 'NO'}\n`);

  const { data: ar } = await axios.get(`${NODE}/bloc/v2.2/contracts/AdminRegistry/000000000000000000000000000000000000100c/state`, { headers: H });
  for (const [addr, name] of Object.entries(BRIDGES)) {
    const entry = ar.whitelist?.[addr] || {};
    console.log(`=== ${name} (${addr}) whitelist`);
    const fns = Object.keys(entry);
    if (fns.length === 0) { console.log('   (no entries at all)'); continue; }
    for (const fn of fns.sort()) {
      const users = Object.keys(entry[fn] || {});
      const hasRelayer = users.includes(RELAYER);
      console.log(`   ${fn.padEnd(26)} relayer=${hasRelayer ? 'YES' : 'no '}  (${users.length} user(s))`);
    }
  }
  // What the fast path needs that is onlyOwner and therefore whitelist-gated.
  // ONLY `onlyOwner` methods consult the AdminRegistry whitelist. The native
  // bridge's relayer entry points (recordDeposit, recordDepositWithFee,
  // recordWithdrawalClaim, confirmDeposit, markWithdrawalPending,
  // finalizeWithdrawal) are `onlyBridgeOperator` -- a direct address check --
  // so they need no whitelist entry and listing them here only produces false
  // alarms. What they need instead is for `bridgeOperator` to BE the relayer,
  // which is checked separately above.
  const NEEDED = {
    MercataBridge: ['depositWithFee', 'depositBatchWithFee', 'recordWithdrawalClaim', 'rejectAnnouncement'],
    StratoNativeBridge: ['rejectAnnouncement'],
  };
  console.log('\n=== MISSING for the fast path');
  for (const [addr, name] of Object.entries(BRIDGES)) {
    for (const fn of NEEDED[name] || []) {
      const ok = ar.whitelist?.[addr]?.[fn]?.[RELAYER];
      if (!ok) console.log(`   ${name}.${fn}`);
    }
  }
})().catch((e) => { console.error(e.response?.status, e.message); process.exit(1); });

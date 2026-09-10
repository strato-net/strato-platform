// Per-validator transaction-fee revenue, from the StratoStaking FeesCredited events.
//
//   node fee-report.js                       report over all recorded fee events
//   node fee-report.js --since 2026-08-22    only events at/after an ISO timestamp
//   node fee-report.js --from-block 254900   only events at/after a block
//   node fee-report.js --bucket hour|day     add a time series
//   node fee-report.js --watch 60            re-run every 60s, showing the delta
//   node fee-report.js --json                machine-readable output
//
// The validator set and its names are read from chain state rather than configured
// here, so validators joining or leaving are picked up automatically.
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const axios = require('axios');

const STAKING = 'd6726e06c3c71a3bad80b5eb6925707a31729b81';
const REGISTRY = 'bfbb75bb6bd0bafa2f5c5b735fe518ade76808dd';
const PAGE = 1000;
const WAD = 10n ** 18n;

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { bucket: null, watch: 0, json: false, since: null, fromBlock: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--bucket') o.bucket = a[++i];
    else if (a[i] === '--watch') o.watch = parseInt(a[++i], 10) || 60;
    else if (a[i] === '--json') o.json = true;
    else if (a[i] === '--since') o.since = a[++i];
    else if (a[i] === '--from-block') o.fromBlock = a[++i];
  }
  return o;
}

// $ from an 18-decimal USDST amount, with enough precision for $0.001 fees.
function usd(wei) {
  const n = BigInt(wei);
  const whole = n / WAD;
  const frac = (n % WAD).toString().padStart(18, '0').slice(0, 6);
  return `$${whole}.${frac}`;
}

async function storage(address) {
  const { data } = await axios.get(`${config.nodes[0].url}/strato-api/eth/v1.2/storage`, {
    params: { address }, timeout: 60000,
  });
  const out = {};
  for (const r of data) {
    const m = /^(?:address|IERC20|Token|ValidatorRegistry)\(([0-9a-fA-F]{40})\)$/.exec(String(r.value));
    out[r.key] = m ? m[1] : r.value;
  }
  return out;
}

// validator address -> display name, from the registry's operator profiles.
function validatorNames(reg) {
  const names = {};
  for (const [k, v] of Object.entries(reg)) {
    let m = /^operators\[([0-9a-fA-F]{40})\]\.name$/.exec(k);
    if (m) names[m[1]] = String(v).replace(/^"|"$/g, '');
  }
  // An operator may run a validator under a different key; prefer that mapping.
  for (const [k, v] of Object.entries(reg)) {
    const m = /^operators\[([0-9a-fA-F]{40})\]\.validatorAddress$/.exec(k);
    if (m && v && v !== m[1] && names[m[1]]) names[v] = names[m[1]];
  }
  return names;
}

async function fetchFees(token, { since, fromBlock }) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = { limit: String(PAGE), offset: String(offset), order: 'block_number.asc' };
    if (since) params.block_timestamp = `gte.${since}`;
    if (fromBlock) params.block_number = `gte.${fromBlock}`;
    const { data } = await axios.get(
      `${config.nodes[0].url}/cirrus/search/BlockApps-StratoStaking-FeesCredited`,
      { headers: { Authorization: `Bearer ${token}` }, params, timeout: 60000 });
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

function bucketKey(ts, bucket) {
  const iso = String(ts).replace(' UTC', 'Z').replace(' ', 'T');
  return bucket === 'day' ? iso.slice(0, 10) : iso.slice(0, 13) + ':00';
}

async function collect(opts) {
  const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
  const [stake, reg, rows] = await Promise.all([
    storage(STAKING), storage(REGISTRY), fetchFees(token, opts),
  ]);
  const names = validatorNames(reg);

  const byValidator = new Map();
  const series = new Map();
  for (const r of rows) {
    const v = r.validator;
    const amt = BigInt(r.amount);
    const cur = byValidator.get(v) || { validator: v, operator: r.operator, fees: 0n, credits: 0, firstBlock: r.block_number, lastBlock: r.block_number, lastTime: r.block_timestamp };
    cur.fees += amt;
    cur.credits += 1;
    cur.lastBlock = r.block_number;
    cur.lastTime = r.block_timestamp;
    byValidator.set(v, cur);

    if (opts.bucket) {
      const k = bucketKey(r.block_timestamp, opts.bucket);
      const b = series.get(k) || new Map();
      b.set(v, (b.get(v) || 0n) + amt);
      series.set(k, b);
    }
  }

  // Liveness counters are keyed by validator address in the staking contract.
  for (const [v, e] of byValidator) {
    e.blocksProposed = stake[`blocksProposed[${v}]`] || '0';
    e.missed = stake[`missedProposals[${v}]`] || '0';
  }
  // Validators in the set that have not earned yet still belong in the report.
  for (const [k, v] of Object.entries(stake)) {
    const m = /^operatorOf\[([0-9a-fA-F]{40})\]$/.exec(k);
    if (m && !byValidator.has(m[1])) {
      byValidator.set(m[1], {
        validator: m[1], operator: v, fees: 0n, credits: 0,
        firstBlock: null, lastBlock: null, lastTime: null,
        blocksProposed: stake[`blocksProposed[${m[1]}]`] || '0',
        missed: stake[`missedProposals[${m[1]}]`] || '0',
      });
    }
  }

  return {
    names, rows, series,
    validators: [...byValidator.values()].sort((a, b) => (b.fees > a.fees ? 1 : b.fees < a.fees ? -1 : 0)),
    totals: {
      totalFeesCredited: stake.totalFeesCredited || '0',
      unattributedFees: stake.unattributedFees || '0',
      trackedUsdst: stake.trackedUsdst || '0',
      proposerFeeBps: stake.proposerFeeBps || '0',
      lastProcessedBlock: stake.lastProcessedBlock || '0',
      usdstToken: stake.usdstToken || '(unset)',
    },
  };
}

function render(snap, prev) {
  const t = snap.totals;
  const sum = snap.validators.reduce((a, v) => a + v.fees, 0n);
  console.log(`\nProposer fee revenue  (proposerFeeBps ${t.proposerFeeBps} = ${Number(t.proposerFeeBps) / 100}% of each fee)`);
  console.log(`last processed block ${t.lastProcessedBlock} | credited ${usd(t.totalFeesCredited)} | unattributed ${usd(t.unattributedFees)} | held ${usd(t.trackedUsdst)}`);
  console.log('');
  console.log('  validator                                 name                     fees      credits  proposed  missed   share    since last run');
  console.log('  ' + '-'.repeat(126));
  for (const v of snap.validators) {
    const name = (snap.names[v.validator] || '').slice(0, 22);
    const share = sum > 0n ? `${(Number(v.fees * 10000n / sum) / 100).toFixed(1)}%` : '-';
    const before = prev ? prev.get(v.validator) : undefined;
    const delta = before === undefined ? '' : usd(v.fees - before);
    console.log(
      `  ${v.validator}  ${name.padEnd(22)}  ${usd(v.fees).padStart(12)}  ${String(v.credits).padStart(7)}  ${String(v.blocksProposed).padStart(8)}  ${String(v.missed).padStart(6)}  ${share.padStart(6)}   ${delta}`);
  }
  console.log('  ' + '-'.repeat(126));
  console.log(`  ${''.padEnd(66)}${usd(sum).padStart(12)}  ${String(snap.rows.length).padStart(7)}`);

  if (snap.series.size) {
    console.log('\n  time series');
    const vs = snap.validators.filter(v => v.fees > 0n).map(v => v.validator);
    console.log('    bucket             ' + vs.map(v => (snap.names[v] || v.slice(0, 8)).slice(0, 12).padStart(13)).join(''));
    for (const [k, b] of [...snap.series.entries()].sort()) {
      console.log(`    ${k.padEnd(18)} ` + vs.map(v => usd(b.get(v) || 0n).padStart(13)).join(''));
    }
  }
}

(async () => {
  const opts = parseArgs();
  let prev = null;
  for (;;) {
    const snap = await collect(opts);
    if (opts.json) {
      console.log(JSON.stringify({
        capturedAt: new Date().toISOString(),
        totals: snap.totals,
        validators: snap.validators.map(v => ({ ...v, fees: v.fees.toString(), name: snap.names[v.validator] || null })),
      }, null, 2));
    } else {
      render(snap, prev);
    }
    if (!opts.watch) return;
    prev = new Map(snap.validators.map(v => [v.validator, v.fees]));
    await new Promise(r => setTimeout(r, opts.watch * 1000));
  }
})().catch(e => { console.error('FAILED:', process.env.DEBUG_STACK ? e.stack : e.message.slice(0, 300)); process.exit(1); });

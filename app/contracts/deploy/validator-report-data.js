// Collect a full validator-activity snapshot (stake, fees, proposals, misses,
// and the fee time series) as JSON, for building a report.
//
//   node validator-report-data.js > report-data.json
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const axios = require('axios');

const STAKING = 'd6726e06c3c71a3bad80b5eb6925707a31729b81';
const REGISTRY = 'bfbb75bb6bd0bafa2f5c5b735fe518ade76808dd';
const PAGE = 1000;

async function storage(address) {
  const { data } = await axios.get(`${config.nodes[0].url}/strato-api/eth/v1.2/storage`, {
    params: { address }, timeout: 90000,
  });
  const out = {};
  for (const r of data) {
    const m = /^(?:address|IERC20|Token|ValidatorRegistry)\(([0-9a-fA-F]{40})\)$/.exec(String(r.value));
    out[r.key] = m ? m[1] : r.value;
  }
  return out;
}

async function cirrusAll(token, table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await axios.get(`${config.nodes[0].url}/cirrus/search/${table}`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { limit: String(PAGE), offset: String(offset), order: 'block_number.asc' },
      timeout: 90000,
    });
    if (!Array.isArray(data) || !data.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const str = (v) => String(v == null ? '' : v).replace(/^"|"$/g, '');

(async () => {
  const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
  const [stake, reg, fees, misses, head] = await Promise.all([
    storage(STAKING),
    storage(REGISTRY),
    cirrusAll(token, 'BlockApps-StratoStaking-FeesCredited'),
    cirrusAll(token, 'BlockApps-StratoStaking-ProposalMissed'),
    axios.get(`${config.nodes[0].url}/strato-api/eth/v1.2/block/last/1`, { timeout: 30000 })
      .then(r => r.data[0].blockData),
  ]);

  // Validators are whatever the staking contract currently maps to an operator.
  const validators = [];
  for (const [k, operator] of Object.entries(stake)) {
    const m = /^operatorOf\[([0-9a-fA-F]{40})\]$/.exec(k);
    if (!m) continue;
    const v = m[1];
    const o = (f) => stake[`operators[${operator}].${f}`];
    validators.push({
      validator: v,
      operator,
      name: str(reg[`operators[${v}].name`] || reg[`operators[${operator}].name`]),
      description: str(reg[`operators[${v}].description`] || reg[`operators[${operator}].description`]),
      active: String(o('active')) === 'true',
      selfBond: str(o('selfBond') || '0'),
      delegatedStake: str(o('delegatedStake') || '0'),
      commissionBps: str(o('commissionBps') || '0'),
      pendingSelfBondFees: str(o('pendingSelfBondFees') || '0'),
      pendingFeeCommission: str(o('pendingFeeCommission') || '0'),
      blocksProposed: str(stake[`blocksProposed[${v}]`] || '0'),
      missedProposals: str(stake[`missedProposals[${v}]`] || '0'),
      consecutiveMisses: str(stake[`consecutiveMisses[${v}]`] || '0'),
      jailedUntil: str(stake[`jailedUntil[${operator}]`] || '0'),
      feesEarned: '0',
      credits: 0,
    });
  }

  const byV = new Map(validators.map(v => [v.validator, v]));
  for (const r of fees) {
    const v = byV.get(r.validator);
    if (!v) continue;
    v.feesEarned = (BigInt(v.feesEarned) + BigInt(r.amount)).toString();
    v.credits += 1;
  }

  const missByV = {};
  for (const r of misses) missByV[r.validator] = (missByV[r.validator] || 0) + 1;

  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    head: { number: str(head.number), timestamp: str(head.timestamp), round: str(head.round) },
    totals: {
      proposerFeeBps: str(stake.proposerFeeBps || '0'),
      totalFeesCredited: str(stake.totalFeesCredited || '0'),
      unattributedFees: str(stake.unattributedFees || '0'),
      trackedUsdst: str(stake.trackedUsdst || '0'),
      lastProcessedBlock: str(stake.lastProcessedBlock || '0'),
      minStake: str(stake.minStake || '0'),
      validatorCount: str(stake.validatorCount || '0'),
      maxConsecutiveMisses: str(stake.maxConsecutiveMisses || '0'),
    },
    validators,
    missEventsByValidator: missByV,
    feeEvents: fees.map(r => ({
      block: str(r.block_number), ts: str(r.block_timestamp),
      validator: r.validator, operator: r.operator, amount: str(r.amount),
    })),
  }, null, 2));
})().catch(e => { console.error('FAILED:', e.message.slice(0, 300)); process.exit(1); });

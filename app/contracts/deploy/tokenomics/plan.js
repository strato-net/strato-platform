// Turn schedule.json (from the spreadsheet) and deployment.json (TGE, addresses,
// grants) into the list of schedule contracts to deploy and fund. Pure: the only
// chain input is externalSupplyWei, the STRATO already minted outside these
// contracts.
//
// Pre-minted supply counts against the categories named in deployment.preMinted:
// fixed amounts come off those categories' funding, and whatever else exists
// ("remainder") comes off the first year of the named emission stream. So the
// categories plus everything already minted add up to exactly the total supply.
const crypto = require('crypto');

const ADDRESS_RE = /^(0x)?[0-9a-fA-F]{40}$/;
const PLACEHOLDER_RE = /^<[^>]+>$/;

function toWei(tokens) {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(String(tokens));
  if (!m) throw new Error(`not a token amount: ${tokens}`);
  return BigInt(m[1]) * 10n ** 18n + BigInt((m[2] || '').padEnd(18, '0'));
}

function formatWei(wei) {
  if (wei < 0n) return `-${formatWei(-wei)}`;
  const s = wei.toString().padStart(19, '0');
  const frac = s.slice(-18).replace(/0+$/, '');
  return s.slice(0, -18) + (frac ? `.${frac}` : '');
}

function parseTge(iso) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(iso)) throw new Error(`tge must look like 2026-10-26T00:00:00Z: ${iso}`);
  return Date.parse(iso) / 1000;
}

// Replace every "<NAME>" placeholder with a random address (the same one for every
// occurrence of a name), for dry runs. Returns the filled copy and the mapping.
function fillPlaceholders(deployment) {
  const mapping = {};
  const fill = (v) => {
    if (typeof v === 'string' && PLACEHOLDER_RE.test(v)) {
      if (!mapping[v]) mapping[v] = crypto.randomBytes(20).toString('hex');
      return mapping[v];
    }
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  return { deployment: fill(deployment), mapping };
}

function buildPlan(schedule, deployment, externalSupplyWei) {
  const problems = [];
  const address = (where, v) => {
    const a = v === 'treasury' ? deployment.treasury : v;
    if (typeof a === 'string' && ADDRESS_RE.test(a)) return a.replace(/^0x/, '').toLowerCase();
    problems.push(`${where}: ${PLACEHOLDER_RE.test(String(a)) ? 'placeholder' : 'not an address'} ${a}`);
    return null;
  };

  const tgeTimestamp = parseTge(deployment.tge);
  const setupAdmin = address('setupAdmin', deployment.setupAdmin);
  const treasury = address('treasury', deployment.treasury);
  const token = address('token', deployment.token);
  const totalSupply = BigInt(schedule.totalSupplyWei);

  const { remainder: remainderKey, ...fixed } = deployment.preMinted || {};
  const preMinted = Object.fromEntries(Object.entries(fixed).map(([k, t]) => [k, toWei(t)]));
  const fixedTotal = Object.values(preMinted).reduce((a, b) => a + b, 0n);
  const remainder = externalSupplyWei - fixedTotal;
  if (remainder < 0n) problems.push(`pre-minted supply ${formatWei(externalSupplyWei)} is less than the fixed pre-minted amounts ${formatWei(fixedTotal)}`);
  if (remainder > 0n && !remainderKey) problems.push(`${formatWei(remainder)} pre-minted STRATO is not assigned to a category`);

  const keys = new Set(schedule.categories.map(c => c.key));
  for (const k of [...Object.keys(preMinted), ...(remainderKey ? [remainderKey] : [])]) {
    if (!keys.has(k)) problems.push(`preMinted names unknown category ${k}`);
  }

  const instances = [];
  for (const c of schedule.categories) {
    const wei = BigInt(c.wei) - (preMinted[c.key] || 0n);
    if (c.kind === 'emission') {
      const yearly = c.yearlyWei.map(BigInt);
      if (c.key === remainderKey && remainder > 0n) {
        if (remainder > yearly[0]) problems.push(`${c.key}: pre-minted remainder ${formatWei(remainder)} exceeds year 1`);
        else yearly[0] -= remainder;
      }
      instances.push({ key: c.key, label: c.label, contract: 'EmissionSchedule', recipient: treasury,
        yearlyWei: yearly, fundWei: yearly.reduce((a, b) => a + b, 0n) });
      continue;
    }
    if (c.key === remainderKey) problems.push(`${c.key}: the remainder must go to an emission stream`);
    if (wei < 0n) problems.push(`${c.key}: pre-minted exceeds the allocation`);
    if (wei <= 0n) continue;

    const grants = [];
    const seen = new Set();
    (deployment.beneficiaries?.[c.key] || []).forEach((g, i) => {
      const a = address(`beneficiaries.${c.key}[${i}]`, g.address);
      if (a && seen.has(a)) problems.push(`beneficiaries.${c.key}: duplicate ${a}`);
      if (a) seen.add(a);
      grants.push({ address: a, wei: toWei(g.tokens) });
    });
    const granted = grants.reduce((s, g) => s + g.wei, 0n);
    if (granted !== wei) problems.push(`beneficiaries.${c.key}: grants total ${formatWei(granted)}, allocation is ${formatWei(wei)}`);
    instances.push({ key: c.key, label: c.label, contract: 'VestingSchedule', cliffMonths: c.cliffMonths,
      cliffUnlockBps: c.cliffUnlockBps, vestingMonths: c.vestingMonths, grants, fundWei: wei });
  }

  const funded = instances.reduce((s, i) => s + i.fundWei, 0n);
  if (funded + externalSupplyWei !== totalSupply) {
    problems.push(`contracts ${formatWei(funded)} + pre-minted ${formatWei(externalSupplyWei)} != total supply ${formatWei(totalSupply)}`);
  }
  return { tgeTimestamp, setupAdmin, treasury, token, totalSupply, externalSupplyWei, remainder, instances, problems };
}

module.exports = { buildPlan, fillPlaceholders, toWei, formatWei, parseTge };

// Turn schedule.json (from the spreadsheet) and deployment.json (TGE, addresses,
// grants) into the list of schedule contracts to deploy and fund. Pure: the only
// chain input is externalSupplyWei, the STRATO already minted outside these
// contracts.
//
// Pre-minted supply counts against the categories named in deployment.preMinted.
// Every token already outside these schedules must be assigned explicitly; unknown
// supply is an error rather than an implicit deduction from another category.
const crypto = require('crypto');

const ADDRESS_RE = /^(0x)?[0-9a-fA-F]{40}$/;
const PLACEHOLDER_RE = /^<[^>]+>$/;
const ZERO_ADDRESS = '0'.repeat(40);

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

function normalizeAddress(value) {
  return String(value || '').replace(/^0x/, '').toLowerCase();
}

function isTrue(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
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

  const preMinted = Object.fromEntries(Object.entries(deployment.preMinted || {}).map(([k, t]) => [k, toWei(t)]));
  const preMintedTotal = Object.values(preMinted).reduce((a, b) => a + b, 0n);
  if (preMintedTotal < externalSupplyWei) {
    problems.push(`${formatWei(externalSupplyWei - preMintedTotal)} pre-minted STRATO is not assigned to a category`);
  } else if (preMintedTotal > externalSupplyWei) {
    problems.push(`assigned pre-minted supply ${formatWei(preMintedTotal)} exceeds live external supply ${formatWei(externalSupplyWei)}`);
  }

  const keys = new Set(schedule.categories.map(c => c.key));
  for (const k of Object.keys(preMinted)) {
    if (!keys.has(k)) problems.push(`preMinted names unknown category ${k}`);
  }

  const instances = [];
  for (const c of schedule.categories) {
    const alreadyMinted = preMinted[c.key] || 0n;
    const wei = BigInt(c.wei) - alreadyMinted;
    if (c.kind === 'emission') {
      const yearly = c.yearlyWei.map(BigInt);
      if (alreadyMinted > 0n) {
        if (alreadyMinted > yearly[0]) problems.push(`${c.key}: pre-minted amount ${formatWei(alreadyMinted)} exceeds year 1`);
        else yearly[0] -= alreadyMinted;
      }
      instances.push({ key: c.key, label: c.label, contract: 'EmissionSchedule', recipient: treasury,
        yearlyWei: yearly, fundWei: yearly.reduce((a, b) => a + b, 0n) });
      continue;
    }
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
  return { tgeTimestamp, setupAdmin, treasury, token, totalSupply, externalSupplyWei, preMintedTotal, instances, problems };
}

// Compare one deployed schedule with the plan. Setup may repair TGE, yearly
// amounts and missing grants, but constructor fields are immutable and must always
// match. Funding and finalization require the complete configured state.
function scheduleProblems(instance, row, details, plan, configured = true) {
  const problems = [];
  const mismatch = (field, got, want) => problems.push(`${instance.key}: ${field} on chain ${got} != plan ${want}`);
  const number = (field, got, want) => {
    try {
      if (BigInt(got) !== BigInt(want)) mismatch(field, got, want);
    } catch {
      mismatch(field, got, want);
    }
  };
  const address = (field, got, want) => {
    if (normalizeAddress(got) !== normalizeAddress(want)) mismatch(field, got, want);
  };

  if (!row) return [`${instance.key}: not created yet`];
  if (row.contract !== instance.contract) mismatch('contract', row.contract, instance.contract);
  if (row.category !== instance.label) mismatch('category', row.category, instance.label);
  address('token', row.token, plan.token);
  if (!isTrue(row.finalized)) address('setupAdmin', row.setupAdmin, plan.setupAdmin);
  else if (normalizeAddress(row.setupAdmin) !== ZERO_ADDRESS) mismatch('finalized setupAdmin', row.setupAdmin, ZERO_ADDRESS);

  if (instance.contract === 'VestingSchedule') {
    number('cliffMonths', row.cliffMonths, instance.cliffMonths);
    number('cliffUnlockBps', row.cliffUnlockBps, instance.cliffUnlockBps);
    number('vestingMonths', row.vestingMonths, instance.vestingMonths);
  } else {
    address('recipient', row.recipient, instance.recipient);
  }

  if (!configured) return problems;
  number('tgeTimestamp', row.tgeTimestamp, plan.tgeTimestamp);
  number('required total', instance.contract === 'VestingSchedule' ? row.totalGranted : row.total, instance.fundWei);

  if (instance.contract === 'EmissionSchedule') {
    const have = details.yearlyWei || [];
    if (have.length !== instance.yearlyWei.length) {
      mismatch('year count', have.length, instance.yearlyWei.length);
    } else {
      for (let i = 0; i < have.length; i++) number(`yearlyAmounts[${i}]`, have[i], instance.yearlyWei[i]);
    }
  } else {
    const have = details.grants || {};
    const want = Object.fromEntries(instance.grants.map(g => [normalizeAddress(g.address), g.wei]));
    for (const [account, amount] of Object.entries(have)) {
      const key = normalizeAddress(account);
      if (!(key in want)) problems.push(`${instance.key}: unexpected on-chain grant ${key}`);
      else number(`grant ${key}`, amount, want[key]);
    }
    for (const [account, amount] of Object.entries(want)) {
      if (!(account in have)) mismatch(`grant ${account}`, 0, amount);
    }
  }
  return problems;
}

function fundingShortfall(instance, row, balance) {
  if (isTrue(row.finalized)) return 0n;
  const held = BigInt(balance);
  if (held > instance.fundWei) throw new Error(`${instance.key}: holds ${formatWei(held)}, more than ${formatWei(instance.fundWei)}`);
  return instance.fundWei - held;
}

// Supply that was minted outside the schedules. Released tokens still belong to
// their original schedule allocation, so count both current balances and
// cumulative releases when removing scheduled supply from the total.
function externalSupply(totalSupply, schedules, balances) {
  const scheduled = schedules.reduce((sum, row) => {
    const balance = BigInt(balances[normalizeAddress(row.address)] || 0);
    const released = BigInt((row.contract === 'VestingSchedule' ? row.totalReleased : row.released) || 0);
    return sum + balance + released;
  }, 0n);
  return BigInt(totalSupply) - scheduled;
}

module.exports = {
  buildPlan, fillPlaceholders, toWei, formatWei, parseTge, normalizeAddress, isTrue, scheduleProblems, fundingShortfall,
  externalSupply,
};

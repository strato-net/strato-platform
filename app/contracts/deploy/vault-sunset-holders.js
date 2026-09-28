#!/usr/bin/env node
/**
 * Diversified Vault sunset: list share holders as redeemAllFor() batches.
 *
 * Read-only. Queries Cirrus (no auth needed) and prints JSON arrays that can be
 * pasted as the `holders` argument. Every admin vote must carry byte-identical
 * arguments, so the output is deterministic: holders sorted by shares (desc),
 * then by address, and chunked into fixed-size batches.
 *
 * Usage:
 *   node vault-sunset-holders.js --vault <vaultProxyAddress> [--node-url https://app.strato.nexus] [--batch-size 10]
 *
 * Examples:
 *   node vault-sunset-holders.js --vault 34bc729f66106a146b0864e673a3571b28fa23e1                       # mainnet
 *   node vault-sunset-holders.js --vault d556695364551c8c7eb336f0bed9aed9e1acd69d --node-url https://app.testnet.strato.nexus
 */

function parseArgs() {
  const out = { 'node-url': process.env.NODE_URL || 'https://app.strato.nexus', 'batch-size': '10' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    out[key] = value;
    i++;
  }
  if (!out.vault) {
    console.error('Usage: node vault-sunset-holders.js --vault <vaultProxyAddress> [--node-url <url>] [--batch-size <n>]');
    process.exit(1);
  }
  return out;
}

async function cirrus(nodeUrl, table, params) {
  const url = `${nodeUrl.replace(/\/$/, '')}/cirrus/search/${table}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'strato-vault-sunset-holders/1.0' } });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const args = parseArgs();
  const nodeUrl = args['node-url'];
  const vault = args.vault.toLowerCase().replace(/^0x/, '');
  const batchSize = Math.max(1, parseInt(args['batch-size'], 10) || 10);

  const vaultRows = await cirrus(nodeUrl, 'BlockApps-Vault', {
    address: `eq.${vault}`,
    select: 'address,shareToken,botExecutor,_paused',
  });
  if (!vaultRows.length || !vaultRows[0].shareToken) throw new Error(`No vault row with a share token at ${vault} on ${nodeUrl}`);
  const { shareToken, botExecutor, _paused } = vaultRows[0];

  const [balanceRows, tokenRows] = await Promise.all([
    cirrus(nodeUrl, 'BlockApps-Token-_balances', { address: `eq.${shareToken}`, select: 'key,value::text', limit: '10000' }),
    cirrus(nodeUrl, 'BlockApps-Token', { address: `eq.${shareToken}`, select: '_symbol,_totalSupply::text' }),
  ]);

  const holders = balanceRows
    .map((r) => ({ address: String(r.key).toLowerCase(), shares: BigInt(r.value || '0') }))
    .filter((h) => h.shares > 0n)
    .sort((a, b) => (a.shares === b.shares ? (a.address < b.address ? -1 : 1) : a.shares > b.shares ? -1 : 1));

  const totalHeld = holders.reduce((sum, h) => sum + h.shares, 0n);
  const totalSupply = BigInt(tokenRows[0]?._totalSupply || '0');
  const fmt = (wei) => (Number(wei / 10n ** 12n) / 1e6).toFixed(6);

  console.error(`node:         ${nodeUrl}`);
  console.error(`vault:        ${vault} (paused: ${_paused})`);
  console.error(`share token:  ${shareToken} (${tokenRows[0]?._symbol || '?'})`);
  console.error(`bot executor: ${botExecutor}`);
  console.error(`holders:      ${holders.length}, holding ${fmt(totalHeld)} of ${fmt(totalSupply)} total shares`);
  if (totalHeld !== totalSupply) console.error('WARNING: holder balances do not sum to totalSupply; Cirrus may be lagging');
  console.error('');
  holders.forEach((h, i) => console.error(`  ${String(i + 1).padStart(3)}  ${h.address}  ${fmt(h.shares).padStart(18)}`));
  console.error('');

  const batches = [];
  for (let i = 0; i < holders.length; i += batchSize) {
    batches.push(holders.slice(i, i + batchSize).map((h) => h.address));
  }
  console.error(`${batches.length} batch(es) of up to ${batchSize}. Each batch below is the exact \`holders\` argument for redeemAllFor:`);
  batches.forEach((b, i) => {
    console.log(`// batch ${i + 1}/${batches.length} (${b.length} holders)`);
    console.log(JSON.stringify(b));
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

// Build the deployable VestingPoolManager source: the manager plus every import
// (VestingPool, the repo Ownable/AdminRegistry/Authorizable/Context, IERC20) combined
// into one canonical text so every admin creates byte-identical source. Comments are
// stripped except SPDX lines (VestingPool.sol is LGPL-3.0-only; the notice must stay).
//
//   node gen-vesting-source.js            -> vesting-source.txt
const config = require('./config');
const path = require('path');
const fs = require('fs');
const { importer } = require('blockapps-rest');
const stripComments = (str) => {
  let out = str.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.split('\n').map((ln) => {
    const t = ln.trim();
    if (t.startsWith('//')) return t.includes('SPDX-License-Identifier') ? ln : '';
    return ln.replace(/\/\/.*$/, '');
  }).join('\n');
  return out;
};
const OUT = process.env.VESTING_SOURCE_OUT || 'vesting-source.txt';
(async () => {
  const fp = path.join(config.resolvePath(config.contractsDir), 'Tokenomics/VestingPoolManager.sol');
  let source = await importer.combine(fp);
  if (Buffer.isBuffer(source)) source = stripComments(source.toString());
  else if (typeof source === 'object') {
    source = Object.keys(source).map((k) => {
      let c = source[k]; c = typeof c === 'string' ? c : String(c);
      c = c.replace(/^.*?\.sol,\s*/i, ''); return stripComments(c);
    }).join('\n');
  } else source = stripComments(String(source));
  fs.writeFileSync(OUT, source);
  const contracts = [...source.matchAll(/^\s*(?:abstract\s+)?contract\s+(?:record\s+)?([A-Za-z0-9_]+)/gm)].map(m => m[1]);
  console.log(`${OUT} written: ${source.length} bytes; contracts: ${contracts.join(', ')}`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

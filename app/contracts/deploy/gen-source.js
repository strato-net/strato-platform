// Combine StratoStaking.sol + imports ONCE, apply upgrade.js's exact processing,
// write canonical bytes to frozen-source.txt so both admins deploy identical source.
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
(async () => {
  const fp = path.join(config.resolvePath(config.contractsDir), 'Staking/StratoStaking.sol');
  let source = await importer.combine(fp);
  if (Buffer.isBuffer(source)) source = stripComments(source.toString());
  else if (typeof source === 'object') {
    source = Object.keys(source).map((k) => {
      let c = source[k]; c = typeof c === 'string' ? c : String(c);
      c = c.replace(/^.*?\.sol,\s*/i, ''); return stripComments(c);
    }).join('\n');
  } else source = stripComments(String(source));
  fs.writeFileSync('frozen-source.txt', source);
  console.log('frozen-source.txt written:', source.length, 'bytes');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

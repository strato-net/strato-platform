// Combine MercataGovernance.sol + imports ONCE and write canonical bytes to
// governance-source.txt, so both admins submit byte-identical source and land on
// the same create-contract issue. Mirrors gen-source.js.
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
  const fp = path.join(config.resolvePath(config.contractsDir), 'Governance/MercataGovernance.sol');
  let source = await importer.combine(fp);
  if (Buffer.isBuffer(source)) source = stripComments(source.toString());
  else if (typeof source === 'object') {
    source = Object.keys(source).map((k) => {
      let c = source[k];
      c = typeof c === 'string' ? c : String(c);
      c = c.replace(/^.*?\.sol,\s*/i, '');
      return stripComments(c);
    }).join('\n');
  } else source = stripComments(String(source));
  fs.writeFileSync('governance-source.txt', source);
  console.log('governance-source.txt written:', source.length, 'bytes');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

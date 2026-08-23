require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const axios = require('axios');
(async () => {
  const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
  for (const t of ['BlockApps-MercataGovernance-ValidatorStakeUpdated','BlockApps-StratoStaking-ValidatorSynced']) {
    try {
      const r = await axios.get(`${config.nodes[0].url}/cirrus/search/${t}`, { headers: { Authorization: `Bearer ${token}` }, params: { limit: 6, order: 'block_number.desc' }, timeout: 30000 });
      console.log(`${t}: ${r.data.length} rows`);
      for (const row of r.data) console.log('   block', row.block_number, '|', row.validator, '|', (row.stake ?? row.weight) ? Number(row.stake ?? row.weight)/1e18 : '');
    } catch (e) { console.log(`${t}: ERR ${e.response ? JSON.stringify(e.response.data).slice(0,90) : e.message}`); }
  }
})();

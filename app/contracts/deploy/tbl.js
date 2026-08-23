require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const axios = require('axios');
(async () => {
  const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
  const names = ['BlockApps-HeliumFeeRouter-BlockRewardsPaid','HeliumFeeRouter-BlockRewardsPaid','BlockApps-FeeRouter-BlockRewardsPaid','BlockRewardsPaid','BlockApps-HeliumFeeRouter'];
  for (const t of names) {
    try {
      const r = await axios.get(`${config.nodes[0].url}/cirrus/search/${t}`, { headers: { Authorization: `Bearer ${token}` }, params: { limit: 3, order: 'block_number.desc' }, timeout: 20000 });
      console.log(`${t}: ${Array.isArray(r.data) ? r.data.length + ' rows' : 'odd'}`);
      if (Array.isArray(r.data) && r.data.length) console.log('   ', JSON.stringify(r.data[0]).slice(0,240));
    } catch (e) { console.log(`${t}: ERR ${e.response ? JSON.stringify(e.response.data).slice(0,80) : e.message}`); }
  }
})();

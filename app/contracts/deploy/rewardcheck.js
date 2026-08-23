require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const axios = require('axios');
(async () => {
  const token = await auth.getUserToken(process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD);
  const r = await axios.get(`${config.nodes[0].url}/cirrus/search/BlockApps-HeliumFeeRouter-BlockRewardsPaid`,
    { headers: { Authorization: `Bearer ${token}` }, params: { limit: 5, order: 'block_number.desc' }, timeout: 30000 }).catch(e => ({data: 'ERR ' + (e.response ? JSON.stringify(e.response.data).slice(0,120) : e.message)}));
  console.log('BlockRewardsPaid rows:', Array.isArray(r.data) ? r.data.length : r.data);
  for (const row of (Array.isArray(r.data) ? r.data : [])) console.log('  block', row.block_number, 'proposer', row.proposer, 'amount', Number(row.amount)/1e18);
})();

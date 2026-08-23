// Resolve OAuth usernames to their STRATO addresses. Useful for checking which
// account owns a contract before sending an onlyOwner transaction.
//
//   node whoami.js                              (GLOBAL_ADMIN_* from .env)
//   node whoami.js blockapps_test 'password'    (one or more username/password pairs)
require('dotenv').config();
const config = require('./config');
const auth = require('./auth');
const { rest } = require('blockapps-rest');

(async () => {
  const argv = process.argv.slice(2);
  const pairs = argv.length >= 2
    ? Array.from({ length: Math.floor(argv.length / 2) }, (_, i) => [argv[2 * i], argv[2 * i + 1]])
    : [[process.env.GLOBAL_ADMIN_NAME, process.env.GLOBAL_ADMIN_PASSWORD]];

  for (const [username, password] of pairs) {
    try {
      const token = await auth.getUserToken(username, password);
      console.log(`${username} -> ${await rest.getKey({ token }, { config })}`);
    } catch (e) {
      console.log(`${username} -> FAILED: ${e.message.slice(0, 120)}`);
    }
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

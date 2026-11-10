const assert = require('node:assert/strict');
const { test } = require('node:test');

for (const name of ['BA_USERNAME', 'BA_PASSWORD', 'CLIENT_SECRET', 'CLIENT_ID', 'OPENID_DISCOVERY_URL', 'ESCROW_ADDRESS']) {
  process.env[name] = 'test';
}

const authId = require.resolve('../src/auth/index.ts');
require.cache[authId] = {
  id: authId, filename: authId, loaded: true,
  exports: { getBAUserToken: async () => 'test-token' },
};
const axios = require('axios');
const { strato, cirrus } = require('../src/utils/api.ts');

test('a lost submission response is not retried, while reads retain retries', async () => {
  const original = axios.request;
  let attempts = 0;
  axios.request = async () => {
    attempts++;
    throw new Error('connection lost after sending request');
  };
  try {
    await assert.rejects(strato.post('/transaction/parallel?resolve=true', {}));
    assert.equal(attempts, 1);
    attempts = 0;
    await assert.rejects(cirrus.get('/mapping'));
    assert.equal(attempts, 2);
  } finally {
    axios.request = original;
  }
});

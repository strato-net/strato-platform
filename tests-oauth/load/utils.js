/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */
import rp from 'request-promise';
import { rest, util } from 'blockapps-rest';

const { getAccounts } = rest;

async function getAccountDetails(user, config) {
  const account = await getAccounts(user, {
    config,
    isAsync: true,
    query: {
      address: user.address,
    },
  });

  return account[0];
}

async function waitResult(initialNonce, user, size, count, config) {
  let nonce = initialNonce;

  while (nonce < initialNonce + (size * count)) {
    await util.sleep(1000);
    try {
      console.log(`Current Nonce is: ${nonce}. Waiting on address '${user.address}' to reach nonce ${initialNonce + (size * count)}`);
      const result = await getAccountDetails(user, config);
      console.log(`Result: ${JSON.stringify(result)}`);
      nonce = result.nonce;
    } catch (e) {
      console.error(e);
    }
  }
}

async function callApi(nodes, user, hash) {
  const options = nodes.map((url) => ({
    method: 'GET',
    uri: `${url}/strato-api/eth/v1.2/transactionResult/${hash}`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${user.token}`,
    },
  }));

  try {
    return await Promise.all(options.map((option) => rp(option)));
  } catch (e) {
    console.log(e);
    return e;
  }
}

export default {
  callApi,
  getAccountDetails,
  waitResult,
};

/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */
import rp from 'request-promise';
import {rest, util, importer, oauthUtil} from 'blockapps-rest';

const { getAccounts } = rest;

import config from '../loadConfig';

const CACHED_DATA = {
  serviceToken: null,
  serviceTokenExpiresAt: null,
}

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

async function createContractArgs(contract, size, initialNonce, batchNum) {
  const { filePath, name, args } = contract;
  const source = await importer.combine(filePath);
  const txs = [];

  for (let i = 0; i < size; i++) {
    txs.push({
      name,
      source,
      args,
      txParams: { nonce: initialNonce + (batchNum * size) + i },
    });
  }

  return txs;
}

const getServiceToken = async (req = null) => {
  const oauth = req ? req.app.oauth : await oauthUtil.init(config.nodes[0].oauth)
  let token = CACHED_DATA.serviceToken
  const expiresAt = CACHED_DATA.serviceTokenExpiresAt
  if (
      !token
      || !expiresAt
      || expiresAt
      <= Math.floor(Date.now() / 1000)
      + constants.tokenLifetimeReserveSeconds
  ) {
    const tokenObj = await oauth.getAccessTokenByClientSecret()
    token = tokenObj.token[
        config.nodes[0].oauth.tokenField
            ? config.nodes[0].oauth.tokenField
            : 'access_token'
        ]
    CACHED_DATA.serviceToken = token
    CACHED_DATA.serviceTokenExpiresAt = Math.floor(
        tokenObj.token.expires_at / 1000,
    )
  }
  return token
}

const getUserToken = async (username, password, req = null) => {
  const oauth = req ? req.app.oauth : await oauthUtil.init(config.nodes[0].oauth)
  const userTokenData = CACHED_DATA[`${username}`]
  
  if (
      userTokenData
      && userTokenData.token
      && userTokenData.expiresAt
      && userTokenData.expiresAt
      > Math.floor(Date.now() / 1000)
      + constants.tokenLifetimeReserveSeconds
  ) {
    console.log('returning cached token')
    return userTokenData.token
  }
  const tokenObj = await oauth.getAccessTokenByResourceOwnerCredential(
      username,
      password,
  )
  const token = tokenObj.token[
      config.nodes[0].oauth.tokenField
          ? config.nodes[0].oauth.tokenField
          : 'access_token'
      ]
  CACHED_DATA[`${username}`] = {
    token,
    expiresAt: Math.floor(tokenObj.token.expires_at / 1000),
  }
  console.log('returning new token')
  return token
}

export default {
  callApi,
  createContractArgs,
  getAccountDetails,
  waitResult,
  getServiceToken,
  getUserToken
};

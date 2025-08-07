/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
import { rest } from 'blockapps-rest';
import fs from 'fs';
import moment from 'moment';

import config from '../loadConfig';
import utils from './utils';


const { createUser, createContractList } = rest;

describe(`Strato Load Test - ${process.env.CONFIG_FILE}`, function beanstalkLoadTest() {
  this.timeout(config.timeout);

  const options = { config };

  let txs = []; let txResults = []; let initialNonce = 0;
  const { batchSize, batchCount, multinode } = config;
  let user = null;

  before(async () => {
    console.log('Obtaining User Token');

    const USERNAME = 'user1'
    const PASSWORD = '1234'

    const userToken = await utils.getUserToken(USERNAME, PASSWORD)
    const userArgs = { token: userToken };

    console.log('Creating User');
    user = await createUser(userArgs, options);
    console.log(`
      Token: ${user.token}
      Address: ${user.address}
    `);
    const account = await utils.getAccountDetails(user, config);
    initialNonce = account.nonce;
  });

  it('Upload contracts', async () => {
    const startTime = moment();
    let transactionsTime = 0;

    for (let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      txs = txs.concat(await utils.createContractArgs(config.contract, batchSize, initialNonce, i));

      const transactionStartTime = moment();
      const transactions = txs.slice(batchSize * i, batchSize * i + batchSize);
      const contracts = await createContractList(user, transactions, {
        isAsync: true,
        ...options,
      });
      transactionsTime += moment().diff(transactionStartTime, 'seconds');

      console.log(`Received ${contracts.length} receipts`);
      txResults = txResults.concat(contracts);
    }

    console.log(`Waiting on address '${user.address}' to reach nonce ${batchSize * batchCount}`);
    await utils.waitResult(initialNonce, user, batchSize, batchCount, config);

    const transactionEndTimeinSec = moment().diff(startTime, 'seconds');

    let resultJson, resultText;

    resultJson = {
      transactions: {
        transaction_time: transactionEndTimeinSec,
        bloc_submission_time: transactionsTime,
        TPS: batchSize * (batchCount / transactionEndTimeinSec),
      },
      measure: 'sec',
    }
    resultText = `
--------------------------------------------
Transaction Time: ${resultJson.transactions.transaction_time} ${resultJson.measure}
Bloc Submission Time: ${resultJson.transactions.bloc_submission_time} ${resultJson.measure}
TPS ${resultJson.transactions.TPS} ${resultJson.measure}
--------------------------------------------
`

    let multinodeEndTimeInSec = 0;

    if (multinode.runTest) {
      const lastTxHash = txResults[(batchSize * batchCount) - 1].hash;

      let isSynced = false;
      while (!isSynced) {
        console.log('Waiting for multinode to be synced');
        const responses = await utils.callApi(multinode.nodes, user, lastTxHash);
        isSynced = responses.every((v) => JSON.parse(v).length === 1);
      }

      multinodeEndTimeInSec = moment().diff(startTime, 'seconds');

      resultJson.multinodeSyncTime = multinodeEndTimeInSec

      resultText = `
--------------------------------------------
Multinode Sync Time: ${multinodeEndTimeInSec} sec ${resultText}
`
    }
    console.log('RESULTS:');
    console.log('JSON format:');
    console.log(resultJson);
    console.log('Text format:');
    console.log(resultText);
    console.log('Saving result.json and result.txt with the results accordingly...')
    fs.writeFileSync('result.json', resultJson);
    fs.writeFileSync('result.txt', resultText);
    console.log('Done.')
  });
});

/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
import { rest, importer } from 'blockapps-rest';
import moment from 'moment';
import utils from './utils';
import config from '../loadConfig';
import '../loadEnv';

const { createUser, createContractList } = rest;

const userArgs = { token: process.env.USER_TOKEN };
const txs = [];
let txResults = [];
let initialNonce = 0;

async function createContractArgs(contract, size, batchNum) {
  const { filePath, name, args } = contract;
  const source = await importer.combine(filePath);

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

describe('Strato Load Test (beanstalk)', function beanstalkLoadTest() {
  this.timeout(config.timeout);

  const options = { config };
  const { batchSize, batchCount, multinode } = config;
  let user;

  before(async () => {
    console.log('Creating User');
    user = await createUser(userArgs, options);
    console.log(`User: ${JSON.stringify(user)}`);
    const account = await utils.getAccountDetails(user, config);
    initialNonce = account.nonce;
  });

  it('Upload contracts', async () => {
    const startTime = moment();
    let transactionsTime = 0;

    for (let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      await createContractArgs(config.contract, batchSize, i);

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
    let message = `
      --------------------------------------------
      Transaction Time: ${transactionEndTimeinSec} sec
      Bloc Submission Time: ${transactionsTime} sec
      TPS ${batchSize * (batchCount / transactionEndTimeinSec)} sec
      --------------------------------------------
    `;

    let multinodeEndTimeInSec = 0;

    if (multinode && multinode.length) {
      const lastTxHash = txResults[(batchSize * batchCount) - 1].hash;

      let isSynced = false;
      while (!isSynced) {
        console.log('Waiting for multinode to be synced');
        const responses = await utils.callApi(multinode, user, lastTxHash);
        isSynced = responses.every((v) => JSON.parse(v).length === 1);
      }

      multinodeEndTimeInSec = moment().diff(startTime, 'seconds');
      message = `
      --------------------------------------------
      Multinode Sync Time: ${multinodeEndTimeInSec} sec ${message}`;
    }

    console.log(message);
  });
});

/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
import { rest, importer, util } from 'blockapps-rest';
import moment from 'moment';
import config from '../loadConfig';
import '../loadEnv';

const { createUser, createContractList, getAccounts } = rest;

const userArgs = { token: process.env.USER_TOKEN };
const txs = [];
let txResults = [];

const batchSize = util.getArgInt('--batchSize', 1);
const batchCount = util.getArgInt('--batchCount', 1);

async function factoryCreateContractArgs(size) {
  const source = await importer.combine('./contracts/beanstalk/agreement/AgreementManager.sol');

  for (let i = 0; i < size; i++) {
    /*
      constructor (
        address _dappAddress,
        address _permissionManager,
        address _userManager,
        address _programManager
      ) public {
    */
    txs.push({
      name: 'AgreementManager',
      source,
      args: {
        _dappAddress: '2383914a2cffe7bb97e0b622481b945858e08188',
        _permissionManager: '2383914a2cffe7bb97e0b622481b945858e08188',
        _programManager: '2383914a2cffe7bb97e0b622481b945858e08188',
        _userManager: '2383914a2cffe7bb97e0b622481b945858e08188',
      },
    });
  }
  return txs;
}

async function getAccountDetails(user) {
  const account = await getAccounts(user, {
    config,
    isAsync: true,
    query: {
      address: user.address,
    },
  });

  return account[0];
}

async function waitResult(user, size, count) {
  let nonce = 0;

  while (nonce < size * count) {
    await util.sleep(1000);
    try {
      console.log(`Current Nonce is: ${nonce}. Waiting on address '${user.address}' to reach nonce ${size * count}`);
      const result = await getAccountDetails(user);
      console.log(`Result: ${JSON.stringify(result)}`);
      nonce = result.nonce;
    } catch (e) {
      console.error(e);
    }
  }
}


describe('Strato Load Test (beanstalk)', function () {
  this.timeout(config.timeout);

  const options = { config };
  let user;

  before(async () => {
    console.log('Creating User');
    user = await createUser(userArgs, options);
    console.log(`User: ${JSON.stringify(user)}`);
  });

  it('Upload contracts', async () => {
    const startTime = moment();
    let transactionsTime = 0;

    for (let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      await factoryCreateContractArgs(batchSize, i);

      const transactionStartTime = moment();
      const transactions = txs.slice(batchSize * i, batchSize * i + batchSize);
      const contracts = await createContractList(user, transactions, {
        isAsync: true,
        ...options,
      });
      const endTime = moment();
      transactionsTime += endTime.diff(transactionStartTime, 'seconds');

      console.log(`Received ${contracts.length} receipts`);
      txResults = txResults.concat(contracts);
      // NOTE: if we don't sleep only half of the contracts uploaded. any other solution for this?
      await util.sleep(1000);
    }

    console.log(`Waiting on address '${user.address}' to reach nonce ${batchSize * batchCount}`);
    await waitResult(user, batchSize, batchCount);

    const endTime = moment();
    const seconds = endTime.diff(startTime, 'seconds');
    console.log(`Total seconds: ${seconds}, Bloc Submission Time: ${transactionsTime}  TPS ${batchSize * (batchCount / seconds)}`);
  });
});

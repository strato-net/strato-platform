/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
import { rest, importer, util } from 'blockapps-rest';
import config from '../loadConfig';
import '../loadEnv';

const { createUser, compileContracts, createContractList } = rest;

const userArgs = { token: process.env.USER_TOKEN };
const txs = [];

const batchSize = util.getArgInt('--batchSize', 1);
const batchCount = util.getArgInt('--batchCount', 1);

async function factoryCreateContractArgs(size) {
  const source = await importer.combine('./contracts/beanstalk/agreement/AgreementManager.sol');

  for (let i = 0; i < size; i++) {
    /* constructor (
      address _dappAddress,
      address _permissionManager,
      address _userManager,
      address _programManager) public { */
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


describe('Strato Load Test (beanstalk)', function () {
  this.timeout(config.timeout);

  const options = { config };
  let user;

  before(async () => {
    console.log('creating user');
    user = await createUser(userArgs, options);
  });

  it('Upload contracts', async () => {
    await factoryCreateContractArgs(2);
    console.log('---------------------------------', txs);
    for (let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      await factoryCreateContractArgs(batchSize, i);
      await compileContracts(user, txs.slice(1), options);
      const contract = await createContractList(user, txs.slice(1), { isAsync: true, ...options });
      console.log('Received receipts', contract);
    }
  });
});

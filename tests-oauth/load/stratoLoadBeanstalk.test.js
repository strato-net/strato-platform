import '../loadEnv';
import config from '../loadConfig';
import { rest, importer, util } from 'blockapps-rest';
const { createUser, createContractList } = rest;

const user1Credentials = { token: process.env.USER1 };
let txs = [], txResults = [];

describe('Strato Load Test (beanstalk)', function () {
  this.timeout(config.timeout);

  const options = { config };
  let user1;

  const batchSize = util.getArgInt('--batchSize', 1);
  const batchCount = util.getArgInt('--batchCount', 1);

  before(async () => {
    console.log('creating user')
    user1 = await createUser(user1Credentials, options);
  })

  it('Upload contracts', async () => {
    for (let i = 0; i < batchCount; i++) {
      console.log(`Creating ${batchSize} transactions for count ${i}`);
      await factory_createContractArgs(batchSize, i);
      const contract = await createContract(user1, txs.slice(1), { isAsync: true, ...options })
      console.log(`Received receipts`, contract);
    }

  });

});

async function factory_createContractArgs(batchSize, batchIndex) {
  for (var i = 0; i < batchSize; i++) {
    // constructor (address _dappAddress, address _permissionManager, address _userManager, address _programManager) public {
    txs.push({
      name: `AgreementManager`,
      source: await importer.combine('./contracts/beanstalk/agreement/AgreementManager.sol'),
      args: {
        _dappAddress: `2383914a2cffe7bb97e0b622481b945858e08188`,
        _permissionManager: `2383914a2cffe7bb97e0b622481b945858e08188`,
        _programManager: `2383914a2cffe7bb97e0b622481b945858e08188`,
        _userManager: `2383914a2cffe7bb97e0b622481b945858e08188`
      }
    });
  }
  return txs;
}

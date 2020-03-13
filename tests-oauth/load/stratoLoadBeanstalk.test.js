import '../loadEnv';
import config from '../loadConfig';
import { rest, importer } from 'blockapps-rest';
const { createUser, createContract } = rest;

const user1Credentials = { token: process.env.USER1 };

describe('Strato Load Test (beanstalk)', async () => {

  const options = { config };
  let user1;

  before(async () => {
    console.log('creating user')
    user1 = await createUser(user1Credentials, options);
  })

  it('Upload contracts', async () => {
    const contractArgs = {
      name: `Agreement`,
      source: await importer.combine('./contracts/beanstalk/agreement/Agreement.sol'),
      // source: await importer.combine('./contracts/beanstalk/PermissionManager.sol'),
      args: {}
    };

    console.log("-------------------", contractArgs)

    const contract = await createContract(user1, contractArgs, options)
  });

});
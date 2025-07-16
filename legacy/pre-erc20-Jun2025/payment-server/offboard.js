import { assert } from 'chai';
import { rest } from 'blockapps-rest';
import config from './load.config.js';
import deployment from './load.deploy.js';
import oauthHelper from './helpers/oauthHelper.js';

// Function to offboard a seller using the 'offboardSeller' method on the Stripe contract
async function offboardSeller(token, contract, sellerCommonName) {
  const callArgs = {
    contract,
    method: 'offboardSeller',
    args: {
      _sellersCommonName: sellerCommonName,
    },
  };
  await rest.call(token, callArgs, { config });
}

// Test suite for deactivating the Stripe payment service
describe('Payment Server - Offboard Stripe Seller', function () {
  this.timeout(config.timeout);

  let token;

  // Fetch service token before tests
  before(async () => {
    assert.isDefined(
      config.configDirPath,
      'configDirPath is missing. Set in config.'
    );

    try {
      token = await oauthHelper.getServiceToken();
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the service token, check the OAuth credentials in config.yaml',
        e
      );
      throw e;
    }
  });

  // Offboard seller from the Stripe payment service
  it('Offboard Seller from Stripe ExternalPaymentService', async () => {
    const sellerCommonName = process.env.SELLER_NAME ?? 
      assert.fail('Seller common name must be provided as a command-line argument.');

    try {
      const stripeContract = deployment.contracts?.stripe;
      if (!stripeContract) {
        console.warn('Stripe contract not deployed. Skipping offboarding.');
        return;
      }

      // Offboard the seller
      await offboardSeller(token, stripeContract, sellerCommonName);
      console.log(`Successfully offboarded seller: ${sellerCommonName}`);

    } catch (error) {
      console.error(`ERROR: Failed to offboard seller: ${sellerCommonName}`, error);
      throw new Error(`Offboarding process failed for seller: ${sellerCommonName}`);
    }
  });
});

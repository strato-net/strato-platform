import { assert } from 'chai'
import { rest } from "blockapps-rest";
import config from './load.config.js';
import deployment from './load.deploy.js';
import oauthHelper from "./helpers/oauthHelper.js";

async function deactivate(token, contract) {
  const callArgs = {
      contract,
      method: 'deactivate',
      args: {},
  };
  await rest.call(token, callArgs, { config, cacheNonce: true });
}

describe("Payment Server - deactivate contracts", function () {
  this.timeout(config.timeout)

  let token

  before(async () => {
    assert.isDefined(
      config.configDirPath,
      "configDirPath is  missing. Set in config"
    )
    try {
      token = await oauthHelper.getServiceToken()
    } catch (e) {
      console.error("ERROR: Unable to fetch the service token, check the OAuth credentials in config.yaml", e)
      throw e
    }
  })

  it('Deactivate Stripe ExternalPaymentService', async () => {
    if (deployment.contracts.stripe) {
      await deactivate(token, deployment.contracts.stripe)
    }
  })

  it('Deactivate USDST TokenPaymentService', async () => {
    if (deployment.contracts.USDST) {
      await deactivate(token, deployment.contracts.USDST)
    }
  })

  it('Deactivate ExternalRedemptionService', async () => {
    if (deployment.contracts.redemption) {
      await deactivate(token, deployment.contracts.redemption)
    }
  })
})

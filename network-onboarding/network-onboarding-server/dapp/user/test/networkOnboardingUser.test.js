import { rest, util, assert } from '/blockapps-rest-plus'
import config from '/load.config'
import oauthHelper from '/helpers/oauthHelper'
import { getCurrentEnode } from '/helpers/enodeHelper'
import { getRoles } from '/helpers/enums'
import dotenv from 'dotenv'

import networkOnboardingUserJs from '../networkOnboardingUser'
import factory from './networkOnboardingUser.factory'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('NetworkOnboarding User', function () {
  this.timeout(config.timeout)

  let networkAdmin

  before(async () => {
    let networkAdminToken
    try {
      networkAdminToken = await oauthHelper.getUserToken(`${process.env.NETWORK_ADMIN_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the admin token, check your OAuth settings in config', e)
      throw e
    }
    const networkAdminCredentials = { token: networkAdminToken }
    networkAdmin = await rest.createUser(networkAdminCredentials, options)
  })

  describe('NetworkOnboarding User', () => {
    let userArgs
    let enodeAddress

    before(async () => {
      userArgs = {
        ...(factory.getNetworkOnboardingUserArgs(util.uid())),
      }
      enodeAddress = getCurrentEnode()
    })

    it('Create NetworkOnboarding User - 201', async () => {
      const contract = await networkOnboardingUserJs.uploadContract(networkAdmin, {
        username: userArgs.username,
        enodeAddress,
        role: (getRoles()).NETWORK_ADMIN,
      }, options)
      const state = await contract.getState()
      assert.equal(state.username, userArgs.username, 'blockchainAddress')
    })
  })
})

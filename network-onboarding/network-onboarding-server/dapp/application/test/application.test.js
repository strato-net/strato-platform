import { rest, util, assert } from '/blockapps-rest-plus'
import config from '/load.config'
import oauthHelper from '/helpers/oauthHelper'
import dotenv from 'dotenv'

import applicationJs from '../application'
import factory from './application.factory'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Application', function () {
  this.timeout(config.timeout)

  let networkAdmin

  before(async () => {
    let networkAdminToken
    try {
      networkAdminToken = await oauthHelper.getUserToken(`${process.env.NETWORK_ADMIN_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the network admin token, check your OAuth settings in config', e)
      throw e
    }
    const networkAdminCredentials = { token: networkAdminToken }
    networkAdmin = await rest.createUser(networkAdminCredentials, options)
  })

  describe('Application', () => {
    let applicationArgs

    before(async () => {
      applicationArgs = {
        ...(factory.getApplicationArgs(util.uid())),
      }
    })

    it('Create Application - 200', async () => {
      const contract = await applicationJs.uploadContract(networkAdmin, applicationArgs, options)
      const state = await contract.getState()
      assert.isSubset(state, applicationArgs, 'application')
    })
  })
})

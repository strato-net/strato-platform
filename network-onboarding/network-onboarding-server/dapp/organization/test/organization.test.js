import { rest, util, assert } from '/blockapps-rest-plus'
import config from '/load.config'
import oauthHelper from '/helpers/oauthHelper'
import dotenv from 'dotenv'

import organizationJs from '../organization'
import factory from './organization.factory'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Organization', function () {
  this.timeout(config.timeout)

  let globalAdmin

  before(async () => {
    let globalAdminToken
    try {
      globalAdminToken = await oauthHelper.getUserToken(`${process.env.GLOBAL_ADMIN_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the admin token, check your OAuth settings in config', e)
      throw e
    }
    const globalAdminCredentials = { token: globalAdminToken }
    globalAdmin = await rest.createUser(globalAdminCredentials, options)
  })

  describe('Organization', () => {
    let organizationArgs

    before(async () => {
      organizationArgs = {
        ...(factory.getOrganizationArgs(util.uid())),
      }
    })

    it('Create Organization - 200', async () => {
      const contract = await organizationJs.uploadContract(globalAdmin, organizationArgs, options)
      const state = await contract.getState()
      assert.isSubset(state, organizationArgs, 'organization')
    })
  })
})

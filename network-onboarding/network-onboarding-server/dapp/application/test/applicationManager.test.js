import { rest, assert, util } from 'blockapps-rest-plus'
import dotenv from 'dotenv'
import RestStatus from 'http-status-codes'

import config from '/load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { getCurrentEnode } from '/helpers/enodeHelper'
import { getRoles } from '/helpers/enums'

import permissionManagerJs from '/dapp/permission/permissionManager'
//import organizationManagerJs from '/dapp/organization/organizationManager'
import applicationManagerJs from '/dapp/application/applicationManager'
import factory from './application.factory'

const options = { config }
const roles = getRoles()

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Application Manager', function () {
  this.timeout(config.timeout)

  let permissionManagerContract
  let applicationManagerContract
  let networkAdmin
  let orgAdmin

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
    
    let orgAdminToken
    try {
      orgAdminToken = await oauthHelper.getUserToken(`${process.env.ORGANIZATION_ADMIN_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the org admin token, check your OAuth settings in config', e)
      throw e
    }
    const orgAdminCredentials = { token: orgAdminToken }
    orgAdmin = await rest.createUser(orgAdminCredentials, options)


    permissionManagerContract = await permissionManagerJs.uploadContract(networkAdmin, {
      admin: networkAdmin.address,
      master: networkAdmin.address,
    }, options)
//    organizationManagerContract = await organizationManagerJs.uploadContract(networkAdmin, {
//      permissionManager: permissionManagerContract.address,
//    }, options)


    // grant roles
    await permissionManagerContract.grantNetworkAdminRole({ user: networkAdmin })
    await permissionManagerContract.grantOrganizationAdminRole({ user: orgAdmin })


  })

  it('Create Application Manager', async () => {

    // TODO: remove
    const TEMP_ORG = `${util.uid()}`.padStart(40, '0');
    
    const contract = await applicationManagerJs.uploadContract(networkAdmin, {
      permissionManager: permissionManagerContract.address,
      organizationManager: TEMP_ORG, //organizationManager: organizationManagerContract.address,
    }, options)

    assert.notEqual(contract.address, constants.zeroAddress, 'Contract address must be not zero')

    const {
      permissionManager,
      applicationManager,
    } = await contract.getState()

    assert.equal(permissionManager, permissionManagerContract.address, 'permissionManager')
//    assert.equal(organizationManager, organizationManagerContract.address, 'organizationManager')
  })

  describe('Application Creation', () => {
    let adminContract
    let orgAdminContract
    let applicationArgs
    let application

    // TODO: remove
    const TEMP_ORG = `${util.uid()}`.padStart(40, '0');


    before(async () => {
      adminContract = await applicationManagerJs.uploadContract(networkAdmin, {
        permissionManager: permissionManagerContract.address,
        organizationManager: TEMP_ORG, //organizationManager: organizationManagerContract.address,
      }, options)

      orgAdminContract = await applicationManagerJs.uploadContract(orgAdmin, {
        permissionManager: permissionManagerContract.address,
        organizationManager: TEMP_ORG, //organizationManager: organizationManagerContract.address,
      }, options)

      applicationArgs = {
        ...(factory.getApplicationArgs(util.uid())),
      }

    })

    it('Create Application - 201 - CREATED', async () => {
      // create Organization
      application = await orgAdminContract.createApplication({
        name: applicationArgs.name,
        ownerOrganization: applicationArgs.ownerOrganization,
      })
      assert.equal(application.name, applicationArgs.name, 'name')
    })

    it('Create Application - 403 - FORBIDDEN', async () => {
      // create Organization
      await assert.restStatus(async () => {
        await adminContract.createApplication({
          name: applicationArgs.name,
          ownerOrganization: applicationArgs.ownerOrganization,
        })
      }, RestStatus.FORBIDDEN)
    })
  })
})

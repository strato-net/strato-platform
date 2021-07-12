import { rest, assert, util } from 'blockapps-rest-plus'
import dotenv from 'dotenv'
import RestStatus from 'http-status-codes'

import config from '/load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { getCurrentEnode } from '/helpers/enodeHelper'
import { getRoles } from '/helpers/enums'

import networkOnboardingPermissionManagerJs from '/dapp/permission/permissionManager'
import userManagerJs from '/dapp/user/networkOnboardingUserManager'
import organizationManagerJs from '/dapp/organization/organizationManager'
import factory from './organization.factory'

const options = { config }
const roles = getRoles()

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Organization Manager', function () {
  this.timeout(config.timeout)

  let permissionManagerContract
  let userManagerContract
  let networkAdmin
  let enodeAddress

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
    enodeAddress = getCurrentEnode()

    permissionManagerContract = await networkOnboardingPermissionManagerJs.uploadContract(networkAdmin, {
      admin: networkAdmin.address,
      master: networkAdmin.address,
    }, options)
    userManagerContract = await userManagerJs.uploadContract(networkAdmin, {
      permissionManager: permissionManagerContract.address,
      enodeAddress,
    }, options)

    // grant network admin role
    await permissionManagerContract.grantNetworkAdminRole({ user: networkAdmin })

    // create network admin user
    await userManagerContract.createUser({
      username: 'network_admin',
      enodeAddress,
      role: roles.NETWORK_ADMIN,
    })
  })

  it('Create Organization Manager', async () => {
    const contract = await organizationManagerJs.uploadContract(networkAdmin, {
      permissionManager: permissionManagerContract.address,
      userManager: userManagerContract.address,
    }, options)

    assert.notEqual(contract.address, constants.zeroAddress, 'Contract address must be not zero')

    const {
      permissionManager,
      userManager,
    } = await contract.getState()

    assert.equal(permissionManager, permissionManagerContract.address, 'permissionManager')
    // assert.equal(userManager, userManagerContract.address, 'userManager')
  })

  describe('Organization Create/Update', () => {
    let contract
    let organizationArgs
    let organization

    before(async () => {
      contract = await organizationManagerJs.uploadContract(networkAdmin, {
        permissionManager: permissionManagerContract.address,
        userManager: userManagerContract.address,
      }, options)

      organizationArgs = {
        ...(factory.getOrganizationArgs(util.uid())),
      }
    })

    it('Create Organization - 201 - CREATED', async () => {
      // create Organization
      organization = await contract.createOrganization({
        commonName: organizationArgs.commonName,
        certificateString: organizationArgs.certificateString
      }, options)
      assert.equal(organization.commonName, organizationArgs.commonName, 'commonName')
    })
  })
})

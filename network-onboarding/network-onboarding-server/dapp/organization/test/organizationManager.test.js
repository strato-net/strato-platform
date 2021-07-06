import { rest, assert, util } from 'blockapps-rest-plus'
import dotenv from 'dotenv'
import RestStatus from 'http-status-codes'

import config from '/load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { getCurrentEnode } from '/helpers/enodeHelper'
import { getRoles } from '/helpers/enums'

import carbonPermissionManagerJs from '/dapp/permission/permissionManager'
import userManagerJs from '/dapp/user/carbonUserManager'
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
  let globalAdmin
  let enodeAddress

  before(async () => {
    let globalAdminToken
    try {
      globalAdminToken = await oauthHelper.getUserToken(`${process.env.GLOBAL_ADMIN_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the global admin token, check your OAuth settings in config', e)
      throw e
    }
    const globalAdminCredentials = { token: globalAdminToken }
    globalAdmin = await rest.createUser(globalAdminCredentials, options)
    enodeAddress = getCurrentEnode()

    permissionManagerContract = await carbonPermissionManagerJs.uploadContract(globalAdmin, {
      admin: globalAdmin.address,
      master: globalAdmin.address,
    }, options)
    userManagerContract = await userManagerJs.uploadContract(globalAdmin, {
      permissionManager: permissionManagerContract.address,
      enodeAddress,
    }, options)

    // grant global admin role
    await permissionManagerContract.grantGlobalAdminRole({ user: globalAdmin })

    // create global admin user
    await userManagerContract.createUser({
      username: 'global_admin',
      enodeAddress,
      role: roles.GLOBAL_ADMIN,
    })
  })

  it('Create Organization Manager', async () => {
    const contract = await organizationManagerJs.uploadContract(globalAdmin, {
      permissionManager: permissionManagerContract.address,
      userManager: userManagerContract.address,
    }, options)

    assert.notEqual(contract.address, constants.zeroAddress, 'Contract address must be not zero')

    const {
      permissionManager,
      userManager,
    } = await contract.getState()

    assert.equal(permissionManager, permissionManagerContract.address, 'permissionManager')
    assert.equal(userManager, userManagerContract.address, 'userManager')
  })

  describe('Organization Create/Update', () => {
    let contract
    let organizationArgs
    let organization

    before(async () => {
      contract = await organizationManagerJs.uploadContract(globalAdmin, {
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
      }, options)
      assert.equal(organization.commonName, organizationArgs.commonName, 'commonName')
    })

    it('Set Organization Private Chain ID - 200 - OK', async () => {
      const privateChainId = `${util.uid()}`.padStart(40, '0')

      organization = await contract.setPrivateChainId({
        organization: organization.address,
        privateChainId,
      }, options)
      assert.equal(organization.privateChainId, privateChainId, 'privateChainId')
    })

    it('Update Organization - 200 - OK', async () => {
      // update Organization
      const {
        commonName,
        ...restArgs
      } = organizationArgs

      organization = await contract.updateOrganization({
        organization: organization.address,
        ...restArgs,
      }, options)
      assert.isSubset(organization, organizationArgs, 'organization')
    })

    it('Update Organization Partially - 200 - OK', async () => {
      const newOrganizationArgs = {
        ...(factory.getOrganizationArgs(util.uid())),
      }

      const {
        commonName,
        state,
        addressLine2,
        postalCode,
      } = newOrganizationArgs

      organization = await contract.updateOrganization({
        organization: organization.address,
        commonName,
        state,
        addressLine2,
        postalCode,
      }, options)
      assert.equal(organization.commonName, newOrganizationArgs.commonName, 'commonName')
      assert.equal(organization.state, newOrganizationArgs.state, 'state')
      assert.equal(organization.addressLine2, newOrganizationArgs.addressLine2, 'addressLine2')
      assert.equal(organization.postalCode, newOrganizationArgs.postalCode, 'postalCode')
    })

    it('Update Organization - 400 - BAD REQUEST', async () => {
      await assert.restStatus(async () => {
        await contract.updateOrganization({}, options)
      }, RestStatus.BAD_REQUEST)
    })
  })
})

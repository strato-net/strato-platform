import { util, rest, assert } from '/blockapps-rest-plus'
import RestStatus from 'http-status-codes'
import config from '/load.config'
import constants from '/helpers/constants'
import { getCurrentEnode } from '/helpers/enodeHelper'
import { getRoles } from '/helpers/enums'
import oauthHelper from '/helpers/oauthHelper'
import dotenv from 'dotenv'

import factory from './networkOnboardingUser.factory'
import networkOnboardingPermissionManagerJs from '/dapp/permission/permissionManager'
import networkOnboardingUserManagerJs from '../networkOnboardingUserManager'

const options = { config }
const roles = getRoles()

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('NetworkOnboarding User Manager', function () {
  this.timeout(config.timeout)

  let enodeAddress
  let networkAdmin
  let orgAdmin
  let permissionManagerContract

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
    const args = {
      admin: networkAdmin.address,
      master: networkAdmin.address,
    }
    permissionManagerContract = await networkOnboardingPermissionManagerJs.uploadContract(networkAdmin, args, options)
    // grant network admin role
    await permissionManagerContract.grantNetworkAdminRole({ user: networkAdmin })
    enodeAddress = getCurrentEnode()

    let orgAdminToken
    try {
      orgAdminToken = await oauthHelper.getUserToken(`${process.env.ORGANIZATION_ADMIN_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the org admin token, check your OAuth settings in config', e)
      throw e
    }
    const orgAdminCredentials = { token: orgAdminToken }
    orgAdmin = await rest.createUser(orgAdminCredentials, options)
    await permissionManagerContract.grantOrganizationAdminRole({ user: orgAdmin })

  })

  it('Create NetworkOnboarding User Manager', async () => {
    console.log("THIS IS BEFORE THE FAILURE!");
    const contract = await networkOnboardingUserManagerJs.uploadContract(networkAdmin, {
      permissionManager: permissionManagerContract.address,
      enodeAddress,
    }, options)
    console.log("THIS IS AFTER THE FAILURE");
    assert.notEqual(contract.address, constants.zeroAddress, 'Contract address must be not zero')

    const {
      permissionManager,
    } = await contract.getState()

    assert.equal(permissionManager, permissionManagerContract.address, 'permissionManager')
  })

  describe('NetworkOnboarding User Create/Update', () => {
    let userArgs
    let contract
    let orgAdminContract


    before(async () => {
      contract = await networkOnboardingUserManagerJs.uploadContract(networkAdmin, {
        permissionManager: permissionManagerContract.address,
        enodeAddress,
      }, options)

      // create network admin user
      await contract.createUser({ 
        username: 'network_admin', 
        enodeAddress: enodeAddress, 
        role: roles.NETWORK_ADMIN, 
      })
      await contract.setUserBlockchainAddress({ 
        username: 'network_admin', 
        blockchainAddress: networkAdmin.address
      })

      // create the org admin user
      await contract.createUser({
        username: 'org_admin',
        enodeAddress: enodeAddress,
        role: roles.ORG_ADMIN,
      })
      await contract.setUserBlockchainAddress({
        username: 'org_admin',
        blockchainAddress: orgAdmin.address,
      })

      // create some test args
      userArgs = {
        ...(factory.getNetworkOnboardingUserArgs(util.uid())),
      }

      // set the network admin's organization
      await contract.setUserOrganization({
        username: 'network_admin',
        organization: userArgs.organization,
      }, options)

      // bind the manager contract to org admin user, for testing permission checks
      orgAdminContract = networkOnboardingUserManagerJs.bindAddress(orgAdmin, contract.address, options)


    })

    it('Create NetworkOnboarding User - 201 - CREATED', async () => {
      // create NetworkOnboarding User
      const networkOnboardingUser = await contract.createUser({
        username: userArgs.username,
        enodeAddress: enodeAddress,
        role: roles.ORG_ADMIN,
      }, options)
      assert.equal(networkOnboardingUser.username, userArgs.username, 'username')
    })

    it('Set NetworkOnboarding User Blockchain Address - 200 - OK', async () => {
      // update NetworkOnboarding User
      const networkOnboardingUser = await contract.setUserBlockchainAddress({
        username: userArgs.username,
        blockchainAddress: userArgs.blockchainAddress,
      }, options)
      assert.equal(networkOnboardingUser.blockchainAddress, userArgs.blockchainAddress, 'blockchainAddress')
    })

    it('Set NetworkOnboarding User Organization - 200 - OK', async () => {
      // update NetworkOnboarding User
      const networkOnboardingUser = await contract.setUserOrganization({
        username: userArgs.username,
        organization: userArgs.organization,
      }, options)
      assert.equal(networkOnboardingUser.organization, userArgs.organization, 'organization')
    })
    
    it('Get NetworkOnboarding User by blockchain address - 200 - OK', async () => {
      // get NetworkOnboarding User by blockchain address
      const args = { blockchainAddress: userArgs.blockchainAddress}
      const networkOnboardingUser = await contract.get(args, options)
      assert.equal(networkOnboardingUser.blockchainAddress, userArgs.blockchainAddress, 'blockchainAddress')
      assert.equal(networkOnboardingUser.organization, userArgs.organization, 'organization')
    })

    it('Get All NetworkOnboarding Users - 200 - OK', async () => {
      // count NetworkOnboarding Users before
      const networkOnboardingUsersBefore = await contract.getAll({}, options)

      // create new NetworkOnboarding User
      const newUserArgs = {
        ...(factory.getNetworkOnboardingUserArgs(util.uid())),
      }
      await contract.createUser({
        username: newUserArgs.username,
        enodeAddress: enodeAddress,
        role: roles.ORG_ADMIN,
      }, options)

      // count NetworkOnboarding Users after
      const networkOnboardingUsersAfter = await contract.getAll({}, options)
      assert.equal(networkOnboardingUsersBefore.length + 1, networkOnboardingUsersAfter.length, 'count')
    })

    it('Create NetworkOnboarding User - 409 - CONFLICT', async () => {
      // create NetworkOnboarding User with the same parameters
      await assert.restStatus(async () => {
        await contract.createUser({
          username: userArgs.username,
          enodeAddress,
          role: roles.ORG_ADMIN,
        }, options)
      }, RestStatus.CONFLICT)
    })

    it('Set User Blockchain Address - 404 - NOT FOUND', async () => {
      // no user exists with this username!
      await assert.restStatus(async () => {
        await contract.setUserBlockchainAddress({
          username: 'endofunctor',
          blockchainAddress: userArgs.blockchainAddress,
        }, options)
      }, RestStatus.NOT_FOUND)
    })

    it('Set User Blockchain Address - 409 - CONFLICT', async () => {
      // this blockchainAddress is already associated with a user!
      await assert.restStatus(async () => {
        await contract.setUserBlockchainAddress({
          username: userArgs.username,
          blockchainAddress: userArgs.blockchainAddress,
        }, options)
      }, RestStatus.CONFLICT)
    })

    it('Set User Organization - 404 - NOT FOUND', async () => {
      // no user exists with this username!
      await assert.restStatus(async () => {
        await contract.setUserOrganization({
          username: 'burrito',
          organization: userArgs.organization,
        }, options)
      }, RestStatus.NOT_FOUND)
    })
    
    it.skip('Create NetworkOnboarding User - 403 - FORBIDDEN - org admin creating network admin', async () => {
      // orgAdmin tries to create a network admin
      await assert.restStatus(async () => {
        await orgAdminContract.createUser({
          username: userArgs.username,
          enodeAddress,
          role: roles.NETWORK_ADMIN,
        }, options)
      }, RestStatus.FORBIDDEN)
    })

    it('Set User Organization - 403 - FORBIDDEN - org admin setting other org as a user org', async () => {
      const newUserArgs = {
        ...(factory.getNetworkOnboardingUserArgs(util.uid())),
      }

      // org admin tries to set a user's org to an org that isn't its org
      await assert.restStatus(async () => {
        await orgAdminContract.setUserOrganization({
          username: userArgs.username,
          organization: newUserArgs.organization,
        }, options)
      }, RestStatus.FORBIDDEN)
    })

  })
})

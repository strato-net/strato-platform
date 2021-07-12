import { rest, assert, util } from 'blockapps-rest-plus'
import dotenv from 'dotenv'
import RestStatus from 'http-status-codes'

import config from '/load.config'
import constants from '/helpers/constants'
import { getRoles, getOrganizationMembershipStates } from '/helpers/enums'
import oauthHelper from '/helpers/oauthHelper'
import { getCurrentEnode } from '/helpers/enodeHelper'

import networkOnboardingPermissionManagerJs from '/dapp/permission/permissionManager'
import userManagerJs from '/dapp/user/networkOnboardingUserManager'
import organizationManagerJs from '/dapp/organization/organizationManager'
import organizationMembershipManagerJs from '/dapp/organization/membership/organizationMembershipManager'
import organizationMembershipJs from '/dapp/organization/membership/organizationMembership'
import factory from './organizationMembership.factory'

const options = { config }
const roles = getRoles()

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('OrganizationMembership Manager', function () {
  this.timeout(config.timeout)

  const OrganizationMembershipState = getOrganizationMembershipStates()

  let permissionManagerContract
  let userManagerContract
  let organizationManagerContract
  let networkAdmin
  let orgAdmin
  let orgUser
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
    organizationManagerContract = await organizationManagerJs.uploadContract(networkAdmin, {
      permissionManager: permissionManagerContract.address,
      userManager: userManagerContract.address,
    }, options)

    // grant network admin role
    await permissionManagerContract.grantNetworkAdminRole({ user: networkAdmin })
    // create network admin user
    await userManagerContract.createUser({
      username: 'network_admin',
      enodeAddress,
      role: roles.NETWORK_ADMIN,
    })
    await userManagerContract.setUserBlockchainAddress({ 
      username: 'network_admin',
      blockchainAddress: networkAdmin.address,
    })
    let orgAdminToken
    try {
      orgAdminToken = await oauthHelper.getUserToken(`${process.env.ORGANIZATION_ADMIN_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the org admin token, check your OAuth settings in config', e)
      throw e
    }
    const orgAdminCredentials = { token: orgAdminToken }
    orgAdmin = await rest.createUser(orgAdminCredentials, options)

    let orgUserToken
    try {
      orgUserToken = await oauthHelper.getUserToken(`${process.env.ORGANIZATION_USER_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the org user token, check your OAuth settings in config', e)
      throw e
    }
    const orgUserCredentials = { token: orgUserToken }
    orgUser = await rest.createUser(orgUserCredentials, options)
  })

  it('Create OrganizationMembership Manager', async () => {
    const contract = await organizationMembershipManagerJs.uploadContract(networkAdmin, {
      permissionManager: permissionManagerContract.address,
      userManager: userManagerContract.address,
      organizationManager: organizationManagerContract.address,
    }, options)

    assert.notEqual(contract.address, constants.zeroAddress, 'Contract address must be not zero')

    const {
      permissionManager,
    //   userManager,
      organizationManager,
    } = await contract.getState()

    assert.equal(permissionManager, permissionManagerContract.address, 'permissionManager')
    // assert.equal(userManager, userManagerContract.address, 'userManager')
    assert.equal(organizationManager, organizationManagerContract.address, 'organizationManager')
  })

  it('Request OrganizationMembership', async () => {
    const contract = await organizationMembershipManagerJs.uploadContract(networkAdmin, {
      permissionManager: permissionManagerContract.address,
      userManager: userManagerContract.address,
      organizationManager: organizationManagerContract.address,
    }, options)
    const userBindedContract = organizationMembershipManagerJs.bindAddress(orgAdmin, contract.address, options)

    const organizationMembershipArgs = {
      ...factory.getOrganizationMembershipManagerArgs(util.uid()),
      enodeAddress,
    }

    const organizationMembershipAddress = await userBindedContract.requestOrganizationMembership(organizationMembershipArgs)
    assert.notEqual(organizationMembershipAddress, constants.zeroAddress, 'Contract address must be not zero')

    const organizationMembershipContract = organizationMembershipJs.bindAddress(networkAdmin, organizationMembershipAddress, options)
    const organizationMembershipState = await organizationMembershipContract.getState()

    assert.equal(organizationMembershipState.organizationCommonName, organizationMembershipArgs.organizationCommonName, 'organizationCommonName')
    assert.equal(organizationMembershipState.requesterCommonName, organizationMembershipArgs.requesterCommonName, 'requesterCommonName')
  })

  describe('Reject organizationMembership', () => {
    let contract
    let organizationMembershipContractAddress

    before(async () => {
      contract = await organizationMembershipManagerJs.uploadContract(networkAdmin, {
        permissionManager: permissionManagerContract.address,
        userManager: userManagerContract.address,
        organizationManager: organizationManagerContract.address,
      }, options)
      const userBindedContract = organizationMembershipManagerJs.bindAddress(orgUser, contract.address, options)
      const organizationMembershipArgs = {
        ...factory.getOrganizationMembershipManagerArgs(util.uid()),
        enodeAddress,
      }
      organizationMembershipContractAddress = await userBindedContract.requestOrganizationMembership(organizationMembershipArgs)
    })

    it('Member can not reject', async () => {
      const userBindedContract = organizationMembershipManagerJs.bindAddress(orgAdmin, contract.address, options)
      await assert.restStatus(
        async () => userBindedContract.rejectOrganizationMembership({
          requesterAddress: orgUser.address,
        }),
        RestStatus.FORBIDDEN,
        /"handleOrganizationMembershipEvent"/,
      )
    })

    it('Admin can reject', async () => {
      await contract.rejectOrganizationMembership({
        requesterAddress: orgUser.address,
      })

      const organizationMembershipContract = organizationMembershipJs.bindAddress(networkAdmin, organizationMembershipContractAddress, options)
      const { state } = await organizationMembershipContract.getState()
      assert.equal(OrganizationMembershipState[state], OrganizationMembershipState[OrganizationMembershipState.REJECTED])
    })
  })

  describe('Accept organizationMembership', () => {
    let contract
    let organizationMembershipContractAddress

    before(async () => {
      contract = await organizationMembershipManagerJs.uploadContract(networkAdmin, {
        permissionManager: permissionManagerContract.address,
        userManager: userManagerContract.address,
        organizationManager: organizationManagerContract.address,
      }, options)
      const userBindedContract = organizationMembershipManagerJs.bindAddress(orgAdmin, contract.address, options)
      const organizationMembershipArgs = {
        ...factory.getOrganizationMembershipManagerArgs(util.uid()),
        enodeAddress,
      }
      organizationMembershipContractAddress = await userBindedContract.requestOrganizationMembership(organizationMembershipArgs)
    })

    it('Member can not accept', async () => {
      const userBindedContract = organizationMembershipManagerJs.bindAddress(orgAdmin, contract.address, options)
      await assert.restStatus(
        async () => userBindedContract.acceptOrganizationMembership({
          requesterAddress: orgAdmin.address,
        }),
        RestStatus.FORBIDDEN,
        /"handleOrganizationMembershipEvent"/,
      )
    })

    it('Admin can accept', async () => {
      await contract.acceptOrganizationMembership({
        requesterAddress: orgAdmin.address,
      })

      const organizationMembershipContract = organizationMembershipJs.bindAddress(networkAdmin, organizationMembershipContractAddress, options)
      const { requesterAddress, state } = await organizationMembershipContract.getState()
      assert.equal(requesterAddress, orgAdmin.address)
      assert.equal(OrganizationMembershipState[state], OrganizationMembershipState[OrganizationMembershipState.ACCEPTED])
    })
  })
})

import { rest, assert } from 'blockapps-rest'
import dotenv from 'dotenv'
import config from '/load.config'
import oauthHelper from '/helpers/oauthHelper'
import networkOnboardingPermissionManager from '../permissionManager'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Permission Manager', function () {
  this.timeout(config.timeout)

  let networkAdmin
  let orgAdmin
  let orgUser
  let contract

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
    const args = {
      admin: networkAdmin.address,
      master: networkAdmin.address,
    }
    contract = await networkOnboardingPermissionManager.uploadContract(networkAdmin, args, options)
    await contract.grantNetworkAdminRole({ user: networkAdmin })

    let orgAdminToken
    try {
      orgAdminToken = await oauthHelper.getUserToken(`${process.env.ORGANIZATION_ADMIN_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the org admin token, check your OAuth settings in config', e)
      throw e
    }
    const orgAdminCredentials = { token: orgAdminToken }
    orgAdmin = await rest.createUser(orgAdminCredentials, options)
    await contract.grantOrganizationAdminRole({ user: orgAdmin })

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

  const generatePermissionsTests = ({
    canInviteOrganization,
    canCreateOrganization,
    canRemoveOrganization,
    canRequestToJoinApplication,
    canInviteToJoinApplication,
    canCreateApplication,
    canInviteToJoinOrganization,
    canCreateOrgUser,
    canCreateAnyUser,
    canReadOrgUser,
    canReadAnyUser,
    canUpdateRoleInNetwork,
    canUpdateRoleInOrganization,
  }) => [
    {
      action: 'invite organization',
      method: 'canInviteOrganization',
      expected: canInviteOrganization || false,
    },
    {
      action: 'create organization',
      method: 'canCreateOrganization',
      expected: canCreateOrganization || false,
    },
    {
      action: 'remove organization',
      method: 'canRemoveOrganization',
      expected: canRemoveOrganization || false,
    },
    {
      action: 'request to join application',
      method: 'canRequestToJoinApplication',
      expected: canRequestToJoinApplication || false,
    },
    {
      action: 'invite to join application',
      method: 'canInviteToJoinApplication',
      expected: canInviteToJoinApplication || false,
    },
    {
      action: 'create application',
      method: 'canCreateApplication',
      expected: canCreateApplication || false,
    },
    {
      action: 'invite to join organization',
      method: 'canInviteToJoinOrganization',
      expected: canInviteToJoinOrganization || false,
    },
    {
      action: 'create an organization user',
      method: 'canCreateOrgUser',
      expected: canCreateOrgUser || false,
    },
    {
      action: 'create any user',
      method: 'canCreateAnyUser',
      expected: canCreateAnyUser || false,
    },
    {
      action: 'read org user',
      method: 'canReadOrgUser',
      expected: canReadOrgUser || false,
    },
    {
      action: 'read any user',
      method: 'canReadAnyUser',
      expected: canReadAnyUser || false,
    },
    {
      action: 'update role in network',
      method: 'canUpdateRoleInNetwork',
      expected: canUpdateRoleInNetwork || false,
    },
    {
      action: 'update role in organization',
      method: 'canUpdateRoleInOrganization',
      expected: canUpdateRoleInOrganization || false,
    },
  ]

  describe('Network Admin role', () => {
    const tests = generatePermissionsTests({
      canInviteOrganization: true,
      canCreateOrganization: true,
      canRemoveOrganization: true,
      canCreateOrgUser: true,
      canCreateAnyUser: true,
      canReadOrgUser: true,
      canReadAnyUser: true,
      canUpdateRoleInNetwork: true,
    })

    tests.forEach((test) => {
      it(`Network Admin ${test.expected ? 'can' : 'can not'} ${test.action}`, async () => {
        const isPermitted = await contract[test.method](networkAdmin)
        assert.equal(
          isPermitted,
          test.expected,
          `Network Admin ${test.expected ? 'should' : 'should not'} be able to ${test.action}`,
        )
      })
    })
  })

  describe('Organization Admin role', () => {
    const tests = generatePermissionsTests({
      canRequestToJoinApplication: true,
      canInviteToJoinApplication: true,
      canCreateApplication: true,
      canInviteToJoinOrganization: true,
      canCreateOrgUser: true,
      canCreateAnyUser: false,
      canReadOrgUser: true,
      canReadAnyUser: false,
      canUpdateRoleInOrganization: true,
    })

    tests.forEach((test) => {
      it(`Organization Admin ${test.expected ? 'can' : 'can not'} ${test.action}`, async () => {
        const isPermitted = await contract[test.method](orgAdmin)
        assert.equal(
          isPermitted,
          test.expected,
          `Organization Admin ${test.expected ? 'should' : 'should not'} be able to ${test.action}`,
        )
      })
    })
  })

  describe('Organization User role', () => {
    const tests = generatePermissionsTests({})

    tests.forEach((test) => {
      it(`Organization User ${test.expected ? 'can' : 'can not'} ${test.action}`, async () => {
        const isPermitted = await contract[test.method](orgUser)
        assert.equal(
          isPermitted,
          test.expected,
          `Organization User ${test.expected ? 'should' : 'should not'} be able to ${test.action}`,
        )
      })
    })
  })
})

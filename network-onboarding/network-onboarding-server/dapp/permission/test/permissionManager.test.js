import { rest, assert } from 'blockapps-rest'
import dotenv from 'dotenv'
import config from '/load.config'
import oauthHelper from '/helpers/oauthHelper'
import carbonPermissionManager from '../permissionManager'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Permission Manager', function () {
  this.timeout(config.timeout)

  let globalAdmin
  let orgAdmin
  let orgUser
  let contract

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
    const args = {
      admin: globalAdmin.address,
      master: globalAdmin.address,
    }
    contract = await carbonPermissionManager.uploadContract(globalAdmin, args, options)
    await contract.grantGlobalAdminRole({ user: globalAdmin })

    let orgAdminToken
    try {
      orgAdminToken = await oauthHelper.getUserToken(`${process.env.ORGANIZATION_ADMIN_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the global admin token, check your OAuth settings in config', e)
      throw e
    }
    const orgAdminCredentials = { token: orgAdminToken }
    orgAdmin = await rest.createUser(orgAdminCredentials, options)
    await contract.grantOrganizationAdminRole({ user: orgAdmin })

    let orgUserToken
    try {
      orgUserToken = await oauthHelper.getUserToken(`${process.env.ORGANIZATION_USER_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the global admin token, check your OAuth settings in config', e)
      throw e
    }
    const orgUserCredentials = { token: orgUserToken }
    orgUser = await rest.createUser(orgUserCredentials, options)
  })

  const generatePermissionsTests = ({
    canModifyMembership,
    canCreateOrganization,
    canUpdateOrganization,
    canUpdateOrganizationLimited,
    canCreateReferenceUnit,
    canUpdateReferenceUnit,
    canCreateUser,
    canCreateUserLimited,
    canUpdateUser,
    canUpdateUserLimited,
  }) => [
    {
      action: 'modify membership',
      method: 'canModifyMembership',
      expected: canModifyMembership || false,
    },
    {
      action: 'create organization',
      method: 'canCreateOrganization',
      expected: canCreateOrganization || false,
    },
    {
      action: 'update organization',
      method: 'canUpdateOrganization',
      expected: canUpdateOrganization || false,
    },
    {
      action: 'update organization (limited)',
      method: 'canUpdateOrganizationLimited',
      expected: canUpdateOrganizationLimited || false,
    },
    {
      action: 'create RU',
      method: 'canCreateReferenceUnit',
      expected: canCreateReferenceUnit || false,
    },
    {
      action: 'update RU',
      method: 'canUpdateReferenceUnit',
      expected: canUpdateReferenceUnit || false,
    },
    {
      action: 'create user',
      method: 'canCreateUser',
      expected: canCreateUser || false,
    },
    {
      action: 'create user (limited)',
      method: 'canCreateUserLimited',
      expected: canCreateUserLimited || false,
    },
    {
      action: 'update user',
      method: 'canUpdateUser',
      expected: canUpdateUser || false,
    },
    {
      action: 'update user (limited)',
      method: 'canUpdateUserLimited',
      expected: canUpdateUserLimited || false,
    },
  ]

  describe('Global Admin role', () => {
    const tests = generatePermissionsTests({
      canModifyMembership: true,
      canCreateOrganization: true,
      canUpdateOrganization: true,
      canCreateReferenceUnit: true,
      canUpdateReferenceUnit: true,
      canCreateUser: true,
      canUpdateUser: true,
    })

    tests.forEach((test) => {
      it(`Global Admin ${test.expected ? 'can' : 'can not'} ${test.action}`, async () => {
        const isPermitted = await contract[test.method](globalAdmin)
        assert.equal(
          isPermitted,
          test.expected,
          `Global Admin ${test.expected ? 'should' : 'should not'} be able to ${test.action}`,
        )
      })
    })
  })

  describe('Organization Admin role', () => {
    const tests = generatePermissionsTests({
      canUpdateOrganizationLimited: true,
      canCreateUserLimited: true,
      canUpdateUserLimited: true,
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

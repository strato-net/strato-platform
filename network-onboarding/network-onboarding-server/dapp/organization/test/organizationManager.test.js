import { rest, assert, util } from 'blockapps-rest-plus'
import dotenv from 'dotenv'
import RestStatus from 'http-status-codes'

import config from '/load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { getCurrentEnode } from '/helpers/enodeHelper'
import { getRoles } from '/helpers/enums'

import networkOnboardingPermissionManagerJs from '/dapp/permission/permissionManager'
import userManagerJs from '/dapp/user-manager/networkOnboardingUserManager'
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
      permissionManager: permissionManagerContract.address
    }, options)

    // grant network admin role
    await permissionManagerContract.grantNetworkAdminRole({ user: networkAdmin })

    // create network admin user
    await userManagerContract.registerUser({
      userAddress: '54321',
      userCertificate: '-----BEGIN CERTIFICATE-----\nMIIBiDCCAS2gAwIBAgIQCgO76hC29iXEFXJNco5ekjAMBggqhkjOPQQDAgUAMEYx\nDDAKBgNVBAMMA2RhbjEMMAoGA1UEBgwDVVNBMRIwEAYDVQQKDAlibG9ja2FwcHMx\nFDASBgNVBAsMC2VuZ2luZWVyaW5nMB4XDTIxMDMxODE1NDgwN1oXDTIyMDMxODE1\nNDgwN1owRjEMMAoGA1UEAwwDZGFuMQwwCgYDVQQGDANVU0ExEjAQBgNVBAoMCWJs\nb2NrYXBwczEUMBIGA1UECwwLZW5naW5lZXJpbmcwVjAQBgcqhkjOPQIBBgUrgQQA\nCgNCAAQY4p67l1IIEUdVC7L+rUDwF5Nv30bze0NV5y8ced7qwp+YFk3UAiOGkcYo\n7ba8F92rd0yf9AGpvZN1H3Dda8xdMAwGCCqGSM49BAMCBQADRwAwRAIgbKXO8tZ5\noPhBusPQFkNEQDnLO/MRru4KjtCpPnVb5sACIE0TwBJ7yeIGuPc/8G50/858Pf3a\n0t1hHbhYnJarPkNA\n-----END CERTIFICATE-----',
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
    assert.equal(userManager, userManagerContract.address, 'userManager')
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
        certificateString: organizationArgs.certificateString
      }, options)
      assert.equal(organization.commonName, organizationArgs.commonName, 'commonName')
    })
  })
})

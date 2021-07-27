import { rest, assert, util } from 'blockapps-rest-plus'
import dotenv from 'dotenv'
import RestStatus from 'http-status-codes'

import config from '/load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { getCurrentEnode } from '/helpers/enodeHelper'
import { getRoles } from '/helpers/enums'

import permissionManagerJs from '/dapp/permission/permissionManager'
import organizationManagerJs from '/dapp/organization/organizationManager'
import applicationManagerJs from '/dapp/application/applicationManager'
import userManagerJs from '/dapp/user-manager/networkOnboardingUserManager'
import factory from './application.factory'

const options = { config }
const roles = getRoles()

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Application Manager', function () {
  this.timeout(config.timeout)

  let permissionManagerContract
  let userManagerContract
  let organizationManagerContract
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
    userManagerContract = await userManagerJs.uploadContract(networkAdmin, {
      permissionManager: permissionManagerContract.address
    }, options)
    organizationManagerContract = await organizationManagerJs.uploadContract(networkAdmin, {
      permissionManager: permissionManagerContract.address,
      userManager: userManagerContract.address
    }, options)


    // grant roles
    await permissionManagerContract.grantNetworkAdminRole({ user: networkAdmin })
    await permissionManagerContract.grantOrganizationAdminRole({ user: orgAdmin })


  })

  it('Create Application Manager', async () => {
    
    const contract = await applicationManagerJs.uploadContract(networkAdmin, {
      permissionManager: permissionManagerContract.address,
      organizationManager: organizationManagerContract.address,
    }, options)

    assert.notEqual(contract.address, constants.zeroAddress, 'Contract address must be not zero')

    const {
      permissionManager,
      organizationManager,
    } = await contract.getState()

    assert.equal(permissionManager, permissionManagerContract.address, 'permissionManager')
    assert.equal(organizationManager, organizationManagerContract.address, 'organizationManager')
  })

  describe('Application Creation', () => {
    let adminContract
    let orgAdminContract
    let applicationArgs
    let application

    before(async () => {
      adminContract = await applicationManagerJs.uploadContract(networkAdmin, {
        permissionManager: permissionManagerContract.address,
        organizationManager: organizationManagerContract.address,
      }, options)

      orgAdminContract = await applicationManagerJs.uploadContract(orgAdmin, {
        permissionManager: permissionManagerContract.address,
        organizationManager: organizationManagerContract.address,
      }, options)

      applicationArgs = {
        ...(factory.getApplicationArgs(util.uid())),
      }

    })

    it.skip('Create Application - 201 - CREATED', async () => {
      // register tx.origin to a certificate
      const result2 = await userManagerContract.registerUser({
        userAddress: orgAdmin.address,
        userCertificate: '-----BEGIN CERTIFICATE-----\nMIIBiDCCAS2gAwIBAgIQCgO76hC29iXEFXJNco5ekjAMBggqhkjOPQQDAgUAMEYx\nDDAKBgNVBAMMA2RhbjEMMAoGA1UEBgwDVVNBMRIwEAYDVQQKDAlibG9ja2FwcHMx\nFDASBgNVBAsMC2VuZ2luZWVyaW5nMB4XDTIxMDMxODE1NDgwN1oXDTIyMDMxODE1\nNDgwN1owRjEMMAoGA1UEAwwDZGFuMQwwCgYDVQQGDANVU0ExEjAQBgNVBAoMCWJs\nb2NrYXBwczEUMBIGA1UECwwLZW5naW5lZXJpbmcwVjAQBgcqhkjOPQIBBgUrgQQA\nCgNCAAQY4p67l1IIEUdVC7L+rUDwF5Nv30bze0NV5y8ced7qwp+YFk3UAiOGkcYo\n7ba8F92rd0yf9AGpvZN1H3Dda8xdMAwGCCqGSM49BAMCBQADRwAwRAIgbKXO8tZ5\noPhBusPQFkNEQDnLO/MRru4KjtCpPnVb5sACIE0TwBJ7yeIGuPc/8G50/858Pf3a\n0t1hHbhYnJarPkNA\n-----END CERTIFICATE-----',
        role: getRoles.ORG_ADMIN
      })

      // create Organization
      const result = await organizationManagerContract.createOrganization({
        userCertificate: '-----BEGIN CERTIFICATE-----\nMIIBiDCCAS2gAwIBAgIQCgO76hC29iXEFXJNco5ekjAMBggqhkjOPQQDAgUAMEYx\nDDAKBgNVBAMMA2RhbjEMMAoGA1UEBgwDVVNBMRIwEAYDVQQKDAlibG9ja2FwcHMx\nFDASBgNVBAsMC2VuZ2luZWVyaW5nMB4XDTIxMDMxODE1NDgwN1oXDTIyMDMxODE1\nNDgwN1owRjEMMAoGA1UEAwwDZGFuMQwwCgYDVQQGDANVU0ExEjAQBgNVBAoMCWJs\nb2NrYXBwczEUMBIGA1UECwwLZW5naW5lZXJpbmcwVjAQBgcqhkjOPQIBBgUrgQQA\nCgNCAAQY4p67l1IIEUdVC7L+rUDwF5Nv30bze0NV5y8ced7qwp+YFk3UAiOGkcYo\n7ba8F92rd0yf9AGpvZN1H3Dda8xdMAwGCCqGSM49BAMCBQADRwAwRAIgbKXO8tZ5\noPhBusPQFkNEQDnLO/MRru4KjtCpPnVb5sACIE0TwBJ7yeIGuPc/8G50/858Pf3a\n0t1hHbhYnJarPkNA\n-----END CERTIFICATE-----'
      })
      application = await orgAdminContract.createApplication({
        name: applicationArgs.name
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

    // TODO: orgAdmin user needs a valid cert for the app's owner for the below tests
    //        also, would be nice to test that a user from a different org can't do it
    it.skip('Add Organization To Application - 200 - OK', async () => {
      await assert.restStatus(async () => {
        await orgAdminContract.addOrganizationToApplication({
          app: application.address,
          org: applicationArgs.ownerOrganization, // TODO: need a real org here
        })
      }, RestStatus.OK) // TODO: check that the value was added rather than just rest status
    })

    it.skip('Add Organization To Application as Network Admin - 403 - FORBIDDEN', async () => {
      // create Organization
      await assert.restStatus(async () => {
        await adminContract.addOrganizationToApplication({
          app: application.address,
          org: applicationArgs.ownerOrganization
        })
      }, RestStatus.FORBIDDEN)
    })

    it.skip('Add Non-Existent Organization to Application - 404 - NOT FOUND', async () => {
      // create Organization
      await assert.restStatus(async () => {
        await orgAdminContract.addOrganizationToApplication({
          app: application.address,
          org: `${util.uid()}`.padStart(40, '0')
        })
      }, RestStatus.NOT_FOUND)
    })

    it.skip('Add Organization to Non-Existent Application - 404 - NOT FOUND', async () => {
      // create Organization
      await assert.restStatus(async () => {
        await adminContract.addOrganizationToApplication({
          app: `${util.uid()}`.padStart(40, '0'),
          org: applicationArgs.ownerOrganization
        })
      }, RestStatus.NOT_FOUND)
    })
  })
})

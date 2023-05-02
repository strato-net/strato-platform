import { rest, assert } from 'blockapps-rest'
import dotenv from 'dotenv'
import config from '/load.config'
import oauthHelper from '/helpers/oauthHelper'
import permissionManager from '../appPermissionManager'
import constants from '/helpers/constants'
import RestStatus from 'http-status-codes'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe.skip('App Chain Permission Manager', function () {
  this.timeout(config.timeout)

  let globalAdmin
  let tradingEntity
  let certifier
  let contract

  before(async () => {
    assert.isDefined(
      config.configDirPath,
      "configDirPath is  missing. Set in config"
    )
    assert.isDefined(
      config.deployFilename,
      "deployFilename is missing. Set in config"
    )
    assert.isDefined(
      process.env.GLOBAL_ADMIN_NAME,
      "GLOBAL_ADMIN_NAME is missing. Add it to .env file"
    )
    assert.isDefined(
      process.env.GLOBAL_ADMIN_PASSWORD,
      "GLOBAL_ADMIN_PASSWORD is missing. Add it to .env file"
    )

    let adminUserName = process.env.GLOBAL_ADMIN_NAME
    let adminUserPassword = process.env.GLOBAL_ADMIN_PASSWORD

    let adminUserToken
    try {
      adminUserToken = await oauthHelper.getUserToken(adminUserName, adminUserPassword)
    } catch (e) {
      console.error("ERROR: Unable to fetch the user token, check your username and password in your .env", e)
      throw e
    }
    let adminCredentials = { token: adminUserToken }
    console.log("getting admin user's address:", adminUserName)
    const adminResponse = await oauthHelper.getStratoUserFromToken(adminCredentials.token)
    console.log("adminResponse", adminResponse)


    assert.strictEqual(
      adminResponse.status,
      RestStatus.OK,
      adminResponse.message
    )
    globalAdmin = { ...adminResponse.user, ...adminCredentials }

    const args = {
      admin: globalAdmin.address,
      master: globalAdmin.address,
    }
    contract = await permissionManager.uploadContract(globalAdmin, args, options)
    await contract.grantAdminRole({ user: globalAdmin })

    // get trading entity token
    let tradingEntityToken
    try {
      tradingEntityToken = await oauthHelper.getUserToken(`${process.env.TRADINGENTITY_NAME}`, `${process.env.TRADINGENTITY_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the user token, check your OAuth settings in config', e)
      throw e
    }
    const tradingEntityCredentials = { token: tradingEntityToken }
    const tradingEntityResponse = await oauthHelper.getStratoUserFromToken(tradingEntityCredentials.token)

    assert.strictEqual(
      tradingEntityResponse.status,
      RestStatus.OK,
      tradingEntityResponse.message
    )
    tradingEntity = { ...tradingEntityResponse.user, ...tradingEntityCredentials }

    await contract.grantTradingEntityRole({ user: tradingEntity })

    // get certifier token
    let certifierToken
    try {
      certifierToken = await oauthHelper.getUserToken(`${process.env.CERTIFIER_NAME}`, `${process.env.CERTIFIER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the user token, check your OAuth settings in config', e)
      throw e
    }
    const certifierCredentials = { token: certifierToken }
    const certifierResponse = await oauthHelper.getStratoUserFromToken(certifierCredentials.token)

    assert.strictEqual(
      certifierResponse.status,
      RestStatus.OK,
      certifierResponse.message
    )
    certifier = { ...certifierResponse.user, ...certifierCredentials }

    await contract.grantCertifierRole({ user: certifier })
  })

  describe('Global Admin role', () => {

    it(`Global Admin can create User Membership`, async () => {
      const isPermitted = await contract.canCreateUserMembership(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to create user Memberships`,
      )
    })

    it(`Global Admin can update User Membership`, async () => {
      const isPermitted = await contract.canUpdateUserMembership(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to update user Memberships`,
      )
    })

    it(`Global Admin can create Product`, async () => {
      const isPermitted = await contract.canCreateProduct(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to create products`,
      )
    })

    it(`Global Admin can update Product`, async () => {
      const isPermitted = await contract.canUpdateProduct(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to update products`,
      )
    })

    it(`Global Admin can delete Product`, async () => {
      const isPermitted = await contract.canDeleteProduct(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to delete products`,
      )
    })

    it(`Global Admin can create Category`, async () => {
      const isPermitted = await contract.canCreateCategory(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to create categories`,
      )
    })

    it(`Global Admin can create Category`, async () => {
      const isPermitted = await contract.canCreateInventory(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to create inventories`,
      )
    })

    it(`Global Admin can update Inventory`, async () => {
      const isPermitted = await contract.canUpdateInventory(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to update inventories`,
      )
    })

    it(`Global Admin can create Order`, async () => {
      const isPermitted = await contract.canCreateOrder(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to create orders`,
      )
    })

    it(`Global Admin can update Order`, async () => {
      const isPermitted = await contract.canUpdateOrder(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to update orders`,
      )
    })

    it(`Global Admin can create Event`, async () => {
      const isPermitted = await contract.canCreateEvent(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to create events`,
      )
    })

    it(`Global Admin can update Event`, async () => {
      const isPermitted = await contract.canUpdateEvent(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to update events`,
      )
    })

    it(`Global Admin can certify Event`, async () => {
      const isPermitted = await contract.canCertifyEvent(globalAdmin)

      assert.equal(
        isPermitted,
        true,
        `Global Admin should be able to certify events`,
      )
    })


  })

  describe('Trading Entity role', () => {

    it(`Trading Entity can create Product`, async () => {
      const isPermitted = await contract.canCreateProduct(tradingEntity)

      assert.equal(
        isPermitted,
        true,
        `Trading Entity should be able to create products`,
      )
    })

    it(`Trading Entity can update Product`, async () => {
      const isPermitted = await contract.canUpdateProduct(tradingEntity)

      assert.equal(
        isPermitted,
        true,
        `Trading Entity should be able to update products`,
      )
    })

    it(`Trading Entity can delete Product`, async () => {
      const isPermitted = await contract.canDeleteProduct(tradingEntity)

      assert.equal(
        isPermitted,
        true,
        `Trading Entity should be able to delete products`,
      )
    })

    it(`Trading Entity can not create Category`, async () => {
      const isPermitted = await contract.canCreateCategory(tradingEntity)

      assert.equal(
        isPermitted,
        false,
        `Trading Entity should be able to create categories`,
      )
    })

    it(`Trading Entity can create Inventory`, async () => {
      const isPermitted = await contract.canCreateInventory(tradingEntity)

      assert.equal(
        isPermitted,
        true,
        `Trading Entity should be able to create inventories`,
      )
    })

    it(`Trading Entity can update Inventory`, async () => {
      const isPermitted = await contract.canUpdateInventory(tradingEntity)

      assert.equal(
        isPermitted,
        true,
        `Trading Entity should be able to update inventories`,
      )
    })

    it(`Trading Entity can create Order`, async () => {
      const isPermitted = await contract.canCreateOrder(tradingEntity)

      assert.equal(
        isPermitted,
        true,
        `Trading Entity should be able to create orders`,
      )
    })

    it(`Trading Entity can update Order`, async () => {
      const isPermitted = await contract.canUpdateOrder(tradingEntity)

      assert.equal(
        isPermitted,
        true,
        `Trading Entity should be able to update orders`,
      )
    })

    it(`Trading Entity can create Event`, async () => {
      const isPermitted = await contract.canCreateEvent(tradingEntity)

      assert.equal(
        isPermitted,
        true,
        `Trading Entity should be able to create events`,
      )
    })

    it(`Trading Entity can update Event`, async () => {
      const isPermitted = await contract.canUpdateEvent(tradingEntity)

      assert.equal(
        isPermitted,
        true,
        `Trading Entity should be able to update events`,
      )
    })

    it(`Trading Entity can not certify Event`, async () => {
      const isPermitted = await contract.canCertifyEvent(tradingEntity)

      assert.equal(
        isPermitted,
        false,
        `Trading Entity should not be able to certify events`,
      )
    })


  })

  describe('Certifier role', () => {

    it(`Certifier can not create Product`, async () => {
      const isPermitted = await contract.canCreateProduct(certifier)

      assert.equal(
        isPermitted,
        false,
        `Certifier should not be able to create products`,
      )
    })

    it(`Certifier can not update Product`, async () => {
      const isPermitted = await contract.canUpdateProduct(certifier)

      assert.equal(
        isPermitted,
        false,
        `Certifier should not be able to update products`,
      )
    })

    it(`Certifier can not delete Product`, async () => {
      const isPermitted = await contract.canDeleteProduct(certifier)

      assert.equal(
        isPermitted,
        false,
        `Certifier should not be able to delete products`,
      )
    })

    it(`Certifier can not create Category`, async () => {
      const isPermitted = await contract.canCreateCategory(certifier)

      assert.equal(
        isPermitted,
        false,
        `Certifier should not be able to create categories`,
      )
    })

    it(`Certifier can not create Inventory`, async () => {
      const isPermitted = await contract.canCreateInventory(certifier)

      assert.equal(
        isPermitted,
        false,
        `Certifier should not be able to create inventories`,
      )
    })

    it(`Certifier can not update Inventory`, async () => {
      const isPermitted = await contract.canUpdateInventory(certifier)

      assert.equal(
        isPermitted,
        false,
        `Certifier should not be able to update inventories`,
      )
    })

    it(`Certifier can not create Order`, async () => {
      const isPermitted = await contract.canCreateOrder(certifier)

      assert.equal(
        isPermitted,
        false,
        `Certifier should not be able to create orders`,
      )
    })

    it(`Certifier can not update Order`, async () => {
      const isPermitted = await contract.canUpdateOrder(certifier)

      assert.equal(
        isPermitted,
        false,
        `Certifier should not be able to update orders`,
      )
    })

    it(`Certifier can not create Event`, async () => {
      const isPermitted = await contract.canCreateEvent(certifier)

      assert.equal(
        isPermitted,
        false,
        `Certifier should not be able to create events`,
      )
    })

    it(`Certifier can not update Event`, async () => {
      const isPermitted = await contract.canUpdateEvent(certifier)

      assert.equal(
        isPermitted,
        false,
        `Certifier should not be able to update events`,
      )
    })

    it(`Certifier can certify Event`, async () => {
      const isPermitted = await contract.canCertifyEvent(certifier)

      assert.equal(
        isPermitted,
        true,
        `Certifier should be able to certify events`,
      )
    })


  })


})

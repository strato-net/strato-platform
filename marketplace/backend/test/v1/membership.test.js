import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes'


import { membershipArgs, updateMembershipArgs } from './factories/membership'
import { Membership, Organizations } from '../../api/v1/endpoints'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Membership End-To-End Tests', function () {
  this.timeout(config.timeout)
  let orgAdmin
  let tradingEntity

  before(async () => {
    let orgAdminToken
    try {
      orgAdminToken = await oauthHelper.getUserToken(
        `${process.env.GLOBAL_ADMIN_NAME}`,
        `${process.env.GLOBAL_ADMIN_PASSWORD}`,
      )
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the org user token, check your OAuth settings in config',
        e,
      )
      throw e
    }

    let tradingEntityToken
    try {
      tradingEntityToken = await oauthHelper.getUserToken(
        `${process.env.TRADINGENTITY_NAME}`,
        `${process.env.TRADINGENTITY_PASSWORD}`,
      )
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the org user token, check your OAuth settings in config',
        e,
      )
      throw e
    }

    const orgAdminCredentials = { token: orgAdminToken }

    const orgAdminResponse = await oauthHelper.getStratoUserFromToken(orgAdminCredentials.token)
    console.log("adminResponse", orgAdminResponse)


    assert.strictEqual(
      orgAdminResponse.status,
      RestStatus.OK,
      orgAdminResponse.message
    )

    const tradingEntityCredentials = { token: tradingEntityToken }

    const tradingEntityResponse = await oauthHelper.getStratoUserFromToken(tradingEntityCredentials.token)

    assert.strictEqual(
      tradingEntityResponse.status,
      RestStatus.OK,
      tradingEntityResponse.message
    )


    orgAdmin = { ...orgAdminResponse.user, ...orgAdminCredentials }
    tradingEntity = { ...tradingEntityResponse.user, ...tradingEntityCredentials }

    console.log("orgAdmin", orgAdmin)
    console.log("tradingEntity", tradingEntity)

  })

  it('Create a Membership', async () => {
    const createArgs = {
      ...membershipArgs(util.uid()),
    }

    const createResponse = await post(
      Membership.prefix,
      Membership.create,
      createArgs,
      orgAdmin.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
  })

  it('Get a Membership', async () => {
    // create
    const createArgs = {
      ...membershipArgs(util.uid()),
    }

    const createResponse = await post(
      Membership.prefix,
      Membership.create,
      createArgs,
      orgAdmin.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')

    // get
    const getResponse = await get(
      Membership.prefix,
      Membership.get.replace(':address', createResponse.body.data.address),
      {},
      orgAdmin.token,
    )

    assert.equal(getResponse.status, 200, 'should be 200');
    assert.isDefined(getResponse.body, 'body should be defined');

    assert.equal(getResponse.body.data['productId'], createArgs['productId'], 'productId should be equal');
    assert.equal(getResponse.body.data['timePeriodInMonths'], createArgs['timePeriodInMonths'], 'timePeriodInMonths should be equal');
    assert.equal(getResponse.body.data['additionalInfo'], createArgs['additionalInfo'], 'additionalInfo should be equal');
    assert.equal(getResponse.body.data['createdDate'], createArgs['createdDate'], 'createdDate should be equal');
  })

  it('Get all Membership', async () => {
    // get
    const getResponse = await get(
      Membership.prefix,
      Membership.getAll,
      {},
      orgAdmin.token,
    )

    assert.equal(getResponse.status, 200, 'should be 200');
    assert.isDefined(getResponse.body, 'body should be defined');
    assert.isDefined(getResponse.body.data, 'body should be defined');
  })

  it('transfer ownership', async () => {

    // create
    const createArgs = {
      ...membershipArgs(util.uid()),
    }

    const createResponse = await post(
      Membership.prefix,
      Membership.create,
      createArgs,
      orgAdmin.token,
    )

    console.log(createResponse.body);

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')




    const transferArgs = {
      address: createResponse.body.data.address,
      newOwner: tradingEntity.address
    }

    // get
    const transferMembership = await post(
      Membership.prefix,
      Membership.transferOwnership,
      transferArgs,
      orgAdmin.token,
    )

    const getResponse = await get(
      Membership.prefix,
      Membership.get.replace(':address', createResponse.body.data.address),
      {},
      orgAdmin.token,
    )

    assert.equal(transferMembership.status, 200, 'should be 200');
    assert.equal(getResponse.body.data.owner, tradingEntity.address, 'should be equal');
  })

  it('update Membership', async () => {
    // create
    const createArgs = {
      ...membershipArgs(util.uid()),
    }

    const createResponse = await post(
      Membership.prefix,
      Membership.create,
      createArgs,
      orgAdmin.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')

    const updateArgs = {
      ...updateMembershipArgs(createResponse.body.data.address, util.uid()),
    }

    const updateMembership = await put(
      Membership.prefix,
      Membership.update,
      updateArgs,
      orgAdmin.token,
    )

    const getMembership = await get(
      Membership.prefix,
      Membership.get.replace(':address', createResponse.body.data.address),
      {},
      orgAdmin.token,
    )

    assert.equal(updateMembership.status, 200, 'should be 200');
    assert.isDefined(updateMembership.body, 'body should be defined');
    assert.equal(getMembership.body.data.machine_ID, updateArgs.machine_ID, 'machine Id should be equal');
    assert.equal(getMembership.body.data.purpose, updateArgs.purpose, 'purpose should be defined');
    assert.equal(getMembership.body.data.model, updateArgs.model, 'model should be defined');
    assert.equal(getMembership.body.data.installation_Date, updateArgs.installation_Date, 'installation_Date should be defined');
  })
})

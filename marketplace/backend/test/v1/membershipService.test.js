import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes'

import { membershipServiceArgs, updateMembershipServiceArgs } from './factories/membershipService'
import { MembershipService, Organizations } from '../../api/v1/endpoints'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('MembershipService End-To-End Tests', function () {
  this.timeout(config.timeout)
  let orgAdmin

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

    const orgAdminCredentials = { token: orgAdminToken }

    const orgAdminResponse = await oauthHelper.getStratoUserFromToken(orgAdminCredentials.token)
    console.log("adminResponse", orgAdminResponse)


    assert.strictEqual(
      orgAdminResponse.status,
      RestStatus.OK,
      orgAdminResponse.message
    )
    orgAdmin = {...orgAdminResponse.user, ...orgAdminCredentials}



  })

  it('Create a MembershipService', async () => {
    const createArgs = {
      ...membershipServiceArgs(util.uid()),
    }

    const createResponse = await post(
      MembershipService.prefix,
      MembershipService.create,
      createArgs,
      orgAdmin.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
  })

  it('Get a MembershipService', async () => {
    // create
    const createArgs = {
      ...membershipServiceArgs(util.uid()),
    }

    const createResponse = await post(
      MembershipService.prefix,
      MembershipService.create,
      createArgs,
      orgAdmin.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')

    // get
    const getMachine = await get(
      MembershipService.prefix,
      MembershipService.get.replace(':address', createResponse.body.data.address).replace(':chainId', createResponse.body.data.chainIds[0]),
      {},
      orgAdmin.token,
    )
      
    assert.equal(getMachine.status, 200, 'should be 200');
    assert.isDefined(getMachine.body, 'body should be defined');
    
      assert.equal(getMachine['membershipId'], createArgs['membershipId'], 'membershipId should be equal');
      assert.equal(getMachine['serviceId'], createArgs['serviceId'], 'serviceId should be equal');
      assert.equal(getMachine['membershipPrice'], createArgs['membershipPrice'], 'membershipPrice should be equal');
      assert.equal(getMachine['discountPrice'], createArgs['discountPrice'], 'discountPrice should be equal');
      assert.equal(getMachine['maxQuantity'], createArgs['maxQuantity'], 'maxQuantity should be equal');
      assert.equal(getMachine['createdDate'], createArgs['createdDate'], 'createdDate should be equal');
      assert.equal(getMachine['isActive'], createArgs['isActive'], 'isActive should be equal');
  })

  it('Get all MembershipService', async () => {
    // get
    const getMachine = await get(
      MembershipService.prefix,
      MembershipService.getAll,
      {},
      orgAdmin.token,
    )

    assert.equal(getMachine.status, 200, 'should be 200');
    assert.isDefined(getMachine.body, 'body should be defined');
    assert.isDefined(getMachine.body.data, 'body should be defined');
  })

  it('update MembershipService', async () => {
    // create
    const createArgs = {
      ...membershipServiceArgs(util.uid()),
    }

    const createResponse = await post(
      MembershipService.prefix,
      MembershipService.create,
      createArgs,
      orgAdmin.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')

    const updateArgs = {
      ...updateMembershipServiceArgs(createResponse.body.data.address, createResponse.body.data.chainIds[0], util.uid()),
    }

    // get
    const getMachine = await put(
      MembershipService.prefix,
      MembershipService.update,
      updateArgs,
      orgAdmin.token,
    )

    assert.equal(getMachine.status, 200, 'should be 200');
    assert.isDefined(getMachine.body, 'body should be defined');
    assert.equal(getMachine.machine_ID, createArgs.machine_ID, 'machine Id should be equal');
    assert.equal(getMachine.purpose, createArgs.purpose, 'purpose should be defined');
    assert.equal(getMachine.model, createArgs.model, 'model should be defined');
    assert.equal(getMachine.installation_Date, createArgs.installation_Date, 'installation_Date should be defined');
  })
})

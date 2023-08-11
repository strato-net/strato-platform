import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes'

import { membershipServiceArgs, updateMembershipServiceArgs } from './factories/membershipService'
import { MembershipService } from '../../api/v1/endpoints'

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
    const getMembershipServiceResponse = await get(
      MembershipService.prefix,
      MembershipService.get.replace(':address', createResponse.body.data.address),
      {},
      orgAdmin.token,
    )

    const membershipService = getMembershipServiceResponse.body.data
    assert.equal(getMembershipServiceResponse.status, 200, 'should be 200');
    assert.isDefined(getMembershipServiceResponse.body, 'body should be defined');
    
      assert.equal(membershipService['membershipId'], createArgs['membershipId'], 'membershipId should be equal');
      assert.equal(membershipService['serviceId'], createArgs['serviceId'], 'serviceId should be equal');
      assert.equal(membershipService['membershipPrice'], createArgs['membershipPrice'], 'membershipPrice should be equal');
      assert.equal(membershipService['discountPrice'], createArgs['discountPrice'], 'discountPrice should be equal');
      assert.equal(membershipService['maxQuantity'], createArgs['maxQuantity'], 'maxQuantity should be equal');
      assert.equal(membershipService['createdDate'], createArgs['createdDate'], 'createdDate should be equal');
      assert.equal(membershipService['isActive'], createArgs['isActive'], 'isActive should be equal');
  })

  it('Get all MembershipService', async () => {
    // get
    const getMembershipServiceResponse = await get(
      MembershipService.prefix,
      MembershipService.getAll,
      {},
      orgAdmin.token,
    )

    assert.equal(getMembershipServiceResponse.status, 200, 'should be 200');
    assert.isDefined(getMembershipServiceResponse.body, 'body should be defined');
    assert.isDefined(getMembershipServiceResponse.body.data, 'body should be defined');
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
      ...updateMembershipServiceArgs(createResponse.body.data.address, util.uid()),
    }

    // get
    const getMembershipServiceResponse = await put(
      MembershipService.prefix,
      MembershipService.update,
      updateArgs,
      orgAdmin.token,
    )

    const membershipService = getMembershipServiceResponse.body.data

    assert.equal(getMembershipServiceResponse.status, 200, 'should be 200');
    assert.isDefined(getMembershipServiceResponse.body, 'body should be defined');
    assert.equal(membershipService['membershipId'], updateArgs['membershipId'], 'membershipId should be equal');
    assert.equal(membershipService['serviceId'], updateArgs['serviceId'], 'serviceId should be equal');
    assert.equal(membershipService['membershipPrice'], updateArgs['membershipPrice'], 'membershipPrice should be equal');
    assert.equal(membershipService['discountPrice'], updateArgs['discountPrice'], 'discountPrice should be equal');
    assert.equal(membershipService['maxQuantity'], updateArgs['maxQuantity'], 'maxQuantity should be equal');
    assert.equal(membershipService['createdDate'], updateArgs['createdDate'], 'createdDate should be equal');
    assert.equal(membershipService['isActive'], updateArgs['isActive'], 'isActive should be equal');
  })
})

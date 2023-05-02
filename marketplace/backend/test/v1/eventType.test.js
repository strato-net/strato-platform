import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes';
import dappJs from '../../dapp/dapp/dapp'

import { eventTypeArgs, updateEventTypeArgs } from './factories/eventType'
import { EventType, Organizations } from '../../api/v1/endpoints'
import {ROLE} from "../../helpers/constants"

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('EventType End-To-End Tests', function () {
  this.timeout(config.timeout)
  let orgAdmin

  before(async () => {
    let orgAdminToken
    try {
      orgAdminToken = await oauthHelper.getUserToken(
        `${process.env.GLOBAL_ADMIN_NAME}`,
        `${process.env.GLOBAL_ADMIN_PASSWORD}`
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
    const dapp = await dappJs.loadFromDeployment(orgAdminCredentials, `${config.configDirPath}/${config.deployFilename}`, options);
    

    assert.strictEqual(
      orgAdminResponse.status,
      RestStatus.OK,
      orgAdminResponse.message
    )
    orgAdmin = { ...orgAdminResponse.user, ...orgAdminCredentials }

    await dapp.managers.userMembershipManager.createUserMembership({
      appChainId:dapp.chainId,
      username:`${process.env.GLOBAL_ADMIN_NAME}`,
      userAddress:orgAdmin.address,
      role:ROLE.TRADING_ENTITY
    });
  })

  it('Create an EventType', async () => {
    // create eventType
    const createArgs = {
      ...eventTypeArgs(util.uid()),
    }

    const createResponse = await post(
      EventType.prefix,
      EventType.create,
      createArgs,
      orgAdmin.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
  })

  it('Get all EventTypes', async () => {
    // get eventTypes
    const getEventTypes = await get(
      EventType.prefix,
      EventType.getAll,
      {},
      orgAdmin.token,
    )

    assert.equal(getEventTypes.status, 200, 'should be 200');
    assert.isDefined(getEventTypes.body, 'body should be defined');
    assert.isDefined(getEventTypes.body.data, 'body should be defined');
  })
})

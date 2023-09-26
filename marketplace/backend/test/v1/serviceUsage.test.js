import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes';
import dappJs from '../../dapp/dapp/dapp'

import { serviceUsageArgs, updateServiceUsageArgs } from './factories/serviceUsage'
import { ServiceUsage } from '../../api/v1/endpoints'

const options = { config }

let test = undefined

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('ServiceUsage End-To-End Tests', function () {
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
    // const dapp = await dappJs.loadFromDeployment(orgAdminCredentials, `${config.configDirPath}/${config.deployFilename}`, options);
    // console.log("dapp: ", dapp)

    assert.strictEqual(
      orgAdminResponse.status,
      RestStatus.OK,
      orgAdminResponse.message
    )
    orgAdmin = { ...orgAdminResponse.user, ...orgAdminCredentials }
    console.log("orgAdmin: ", orgAdmin)
  })

  it('Create an Service', async () => {
    // create eventType
    const createArgs = {
      ...serviceUsageArgs(util.uid()),
    }
    console.log("createArgs: ", createArgs)

    const createResponse = await post(
      ServiceUsage.prefix,
      ServiceUsage.create,
      createArgs,
      orgAdmin.token,
    )
    console.log("createResponse.body.data: ", createResponse.body.data)
    test = createResponse.body.data.address
    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
  })
  
  it('Get a ServiceUsage', async () => {
    
    const getService = await get(
      ServiceUsage.prefix,
      ServiceUsage.get.replace(':address', test),
      {},
      orgAdmin.token,
    )
    
    assert.equal(getService.status, 200, 'should be 200');
    assert.isDefined(getService.body, 'body should be defined');
  })

  it('Get all ServiceUsages', async () => {
    
    // get Services
    const getServices = await get(
      ServiceUsage.prefix,
      ServiceUsage.getAll,
      {},
      orgAdmin.token,
    )
    
    assert.equal(getServices.status, 200, 'should be 200');
    assert.isDefined(getServices.body, 'body should be defined');
    assert.isDefined(getServices.body.data, 'body should be defined');
  })
  
  it('update Service', async () => {
    // create eventType
    const createArgs = {
      ...serviceUsageArgs(util.uid()),
    }
    console.log("createArgs: ", createArgs)

    const createResponse = await post(
      ServiceUsage.prefix,
      ServiceUsage.create,
      createArgs,
      orgAdmin.token,
    )
    
    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
    
    const getService0 = await get(
      ServiceUsage.prefix,
      ServiceUsage.get.replace(':address', createResponse.body.data.address),
      {},
      orgAdmin.token,
    )
    
    assert.equal(getService0.status, 200, 'should be 200');
    assert.isDefined(getService0.body, 'body should be defined');
    console.log("getService0: ", getService0.body.data)

    const updateArgs = {
      ...updateServiceUsageArgs(createResponse.body.data.address, util.uid()),
    }

    // get
    const updateService = await put(
      ServiceUsage.prefix,
      ServiceUsage.update,
      updateArgs,
      orgAdmin.token,
    )
    assert.equal(updateService.status, 200, 'should be 200');
    assert.isDefined(updateService.body, 'body should be defined');
    console.log("updateService: ", updateService.body.data)
    
    const getService = await get(
      ServiceUsage.prefix,
      ServiceUsage.get.replace(':address', createResponse.body.data.address),
      {},
      orgAdmin.token,
    )
    
    assert.equal(getService.status, 200, 'should be 200');
    assert.isDefined(getService.body, 'body should be defined');
    console.log("getService: ", getService.body.data)
    
    assert.equal(getService.body.data.status, updateArgs.updates.status);
    assert.equal(getService.body.data.paymentStatus, updateArgs.updates.paymentStatus)
    assert.equal(getService.body.data.summary, updateArgs.updates.summary)
    assert.equal(getService.body.data.serviceDate, updateArgs.updates.serviceDate);
    assert.equal(getService.body.data.providerComment, updateArgs.updates.providerComment);
    assert.equal(getService.body.data.providerLastUpdatedDate, updateArgs.updates.providerLastUpdatedDate)
    assert.equal(getService.body.data.providerLastUpdated, updateArgs.updates.providerLastUpdated);
    assert.equal(getService.body.data.pricePaid, updateArgs.updates.pricePaid);

    assert.equal(getService.body.data.address, getService0.body.data.address);
    assert.equal(getService.body.data.createdDate, getService0.body.data.createdDate);
    assert.equal(getService.body.data.owner, getService0.body.data.owner);
    assert.equal(getService.body.data.itemId, getService0.body.data.itemId);
    assert.equal(getService.body.data.serviceId, getService0.body.data.serviceId);
  })
})

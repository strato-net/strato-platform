import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes';
import dappJs from '../../dapp/dapp/dapp'

import { serviceArgs, updateServiceArgs } from './factories/service'
import { Service } from '../../api/v1/endpoints'

const options = { config }

let test = undefined

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('Service End-To-End Tests', function () {
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
      ...serviceArgs(util.uid()),
    }
    console.log("createArgs: ", createArgs)

    const createResponse = await post(
      Service.prefix,
      Service.create,
      createArgs,
      orgAdmin.token,
    )
    console.log("createResponse: ", createResponse.body.data)
    test = createResponse.body.data[1]
    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
  })
  
  it('Get a Service', async () => {
    
    const getService = await get(
      Service.prefix,
      Service.get.replace(':address', test),
      {},
      orgAdmin.token,
    )
    
    assert.equal(getService.status, 200, 'should be 200');
    assert.isDefined(getService.body, 'body should be defined');
    console.log(" a getService: ", getService.body.data)
  })

  it('Get all Services', async () => {
    
    // get Services
    const getServices = await get(
      Service.prefix,
      Service.getAll,
      {},
      orgAdmin.token,
    )
    console.log("getServices: ", getServices.body.data)
    assert.equal(getServices.status, 200, 'should be 200');
    assert.isDefined(getServices.body, 'body should be defined');
    assert.isDefined(getServices.body.data, 'body should be defined');
  })
  
  it('update Service', async () => {
    // create eventType
    const createArgs = {
      ...serviceArgs(util.uid()),
    }
    console.log("createArgs: ", createArgs)

    const createResponse = await post(
      Service.prefix,
      Service.create,
      createArgs,
      orgAdmin.token,
    )
    
    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
    
    const getService0 = await get(
      Service.prefix,
      Service.get.replace(':address', createResponse.body.data[1]),
      {},
      orgAdmin.token,
    )
    
    assert.equal(getService0.status, 200, 'should be 200');
    assert.isDefined(getService0.body, 'body should be defined');
    console.log("getService0: ", getService0.body.data)

    const updateArgs = {
      ...updateServiceArgs(createResponse.body.data[1], util.uid()),
    }

    // get
    const getMachine = await put(
      Service.prefix,
      Service.update,
      updateArgs,
      orgAdmin.token,
    )
    assert.equal(getMachine.status, 200, 'should be 200');
    assert.isDefined(getMachine.body, 'body should be defined');
    
    const getService = await get(
      Service.prefix,
      Service.get.replace(':address', createResponse.body.data[1]),
      {},
      orgAdmin.token,
    )
    
    assert.equal(getService.status, 200, 'should be 200');
    assert.isDefined(getService.body, 'body should be defined');
    console.log("getService: ", getService.body.data)
    
    assert.notStrictEqual(getService.body.data.name, getService0.body.data.name)
    assert.notStrictEqual(getService.body.data.description, getService0.body.data.description)
    assert.notStrictEqual(getService.body.data.price, getService0.body.data.price)
    assert.equal(getService.body.data.createdDate, getService0.body.data.createdDate);
  })
})

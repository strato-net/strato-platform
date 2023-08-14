import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { get, post, put } from '/helpers/rest'
import RestStatus from 'http-status-codes';


import { productFileArgs, updateProductFileArgs } from './factories/productFile'
import { ProductFile } from '../../api/v1/endpoints'

const options = { config }

let test = undefined
let temp = undefined

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('ProductFile End-To-End Tests', function () {
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

  it('Create a ProductFile', async () => {
    const createArgs = {
      ...productFileArgs(util.uid()),
    }
    
    temp = createArgs;
    
    const createResponse = await post(
      ProductFile.prefix,
      ProductFile.create,
      createArgs,
      orgAdmin.token,
    )

    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined');
    assert.isDefined(createResponse.body.data, 'body.data should be defined');
    test = createResponse.body.data.address;
  })

  it('Get a ProductFile', async () => {
    const getProductFile = await get(
      ProductFile.prefix,
      ProductFile.get.replace(':address', test),
      {},
      orgAdmin.token,
    )

    assert.equal(getProductFile.status, 200, 'should be 200');
    assert.isDefined(getProductFile.body, 'body should be defined');
    assert.isDefined(getProductFile.body.data, 'body.data should be defined');
    assert.equal(getProductFile.body.data.currentType, temp.type, 'currentType should be defined');
    assert.equal(getProductFile.body.data.fileName, temp.fileName, 'fileName should be defined');
    assert.equal(getProductFile.body.data.currentSection, temp.section, 'currentSection should be defined');
    assert.equal(getProductFile.body.data.fileHash, temp.fileHash, 'fileHash should be defined');
    assert.equal(getProductFile.body.data.fileLocation, temp.fileLocation, 'fileLocation should be defined');
    assert.equal(getProductFile.body.data.productId, temp.productId, 'productId should be defined');
    assert.equal(getProductFile.body.data.uploadDate, temp.uploadDate, 'uploadDate should be defined');
  })

  it('Get all ProductFiles', async () => {
    // get
    const getProductFiles = await get(
      ProductFile.prefix,
      ProductFile.getAll,
      {},
      orgAdmin.token,
    )

    assert.equal(getProductFiles.status, 200, 'should be 200');
    assert.isDefined(getProductFiles.body, 'body should be defined');
    assert.isDefined(getProductFiles.body.data, 'body should be defined');
  })

  
  it('update ProductFile', async () => {
    // create eventType
    const createArgs = {
      ...productFileArgs(util.uid()),
    }
    console.log("createArgs: ", createArgs)

    const createResponse = await post(
      ProductFile.prefix,
      ProductFile.create,
      createArgs,
      orgAdmin.token,
    )
    
    assert.equal(createResponse.status, 200, 'should be 200');
    assert.isDefined(createResponse.body, 'body should be defined')
    
    const getProductFile0 = await get(
      ProductFile.prefix,
      ProductFile.get.replace(':address', createResponse.body.data.address),
      {},
      orgAdmin.token,
    )
    
    assert.equal(getProductFile0.status, 200, 'should be 200');
    assert.isDefined(getProductFile0.body, 'body should be defined');
    console.log("getProductFile0: ", getProductFile0.body.data)

    const updateArgs = {
      ...updateProductFileArgs(createResponse.body.data.address, util.uid()),
    }

    // get
    const updateProductFile = await put(
      ProductFile.prefix,
      ProductFile.update,
      updateArgs,
      orgAdmin.token,
    )
    assert.equal(updateProductFile.status, 200, 'should be 200');
    assert.isDefined(updateProductFile.body, 'body should be defined');
    console.log("updateProductFile: ", updateProductFile.body.data)
    
    const getProductFile = await get(
      ProductFile.prefix,
      ProductFile.get.replace(':address', createResponse.body.data.address),
      {},
      orgAdmin.token,
    )
    
    assert.equal(getProductFile.status, 200, 'should be 200');
    assert.isDefined(getProductFile.body, 'body should be defined');
    assert.equal(getProductFile.body.data.fileName, updateArgs.updates.fileName)
    assert.equal(getProductFile.body.data.fileLocation, updateArgs.updates.fileLocation)
    assert.equal(getProductFile.body.data.fileHash, updateArgs.updates.fileHash)
    assert.equal(getProductFile.body.data.uploadDate, updateArgs.updates.uploadDate)
    assert.equal(getProductFile.body.data.currentSection, updateArgs.updates.section)
    assert.equal(getProductFile.body.data.currentType, updateArgs.updates.type)

    assert.notStrictEqual(getProductFile.body.data.fileName, getProductFile0.body.data.fileName)
    assert.notStrictEqual(getProductFile.body.data.fileLocation, getProductFile0.body.data.fileLocation)
    assert.notStrictEqual(getProductFile.body.data.fileHash, getProductFile0.body.data.fileHash)
    assert.notStrictEqual(getProductFile.body.data.uploadDate, getProductFile0.body.data.uploadDate)
    assert.notStrictEqual(getProductFile.body.data.currentType, getProductFile0.body.data.currentType)
    assert.equal(getProductFile.body.data.address, getProductFile0.body.data.address)
    assert.equal(getProductFile.body.data.createdDate, getProductFile0.body.data.createdDate);
    assert.equal(getProductFile.body.data.owner, getProductFile0.body.data.owner);
  })
})

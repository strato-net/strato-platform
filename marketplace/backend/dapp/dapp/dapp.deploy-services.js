import { assert } from 'chai'
import { rest } from 'blockapps-rest'
import config from "/load.config"
import oauthHelper from "/helpers/oauthHelper"
import { getYamlFile, yamlWrite } from '/helpers/config'
import RestStatus from "http-status-codes"
import dotenv from 'dotenv'

import dappJs from "./dapp"
import ServiceSeederJs from "/seeder-utility/serviceSeeder";
import ServiceJson from "/seeder-utility/service.json";
import { ROLE } from "/helpers/constants";
const options = { config, logger: console }
const loadEnv = dotenv.config()
import { fsUtil } from 'blockapps-rest'

describe("Marketplace Dapp - load services for an Org", function () {
  this.timeout(config.timeout)

  let adminCredentials
  let adminUser

  let dapp

  let appChainID

  let adminUserName
  let adminUserPassword

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
      process.env.ORG_ADMIN_NAME,
      "ORG_ADMIN_NAME is missing. Add it to .env file"
    )
    assert.isDefined(
      process.env.ORG_ADMIN_PASSWORD,
      "ORG_ADMIN_PASSWORD is missing. Add it to .env file"
    )

    adminUserName = process.env.ORG_ADMIN_NAME
    adminUserPassword = process.env.ORG_ADMIN_PASSWORD

    let adminUserToken
    try {
      adminUserToken = await oauthHelper.getUserToken(adminUserName, adminUserPassword)
    } catch (e) {
      console.error("ERROR: Unable to fetch the user token, check your username and password in your .env", e)
      throw e
    }
    adminCredentials = { token: adminUserToken }
    console.log("getting admin user's address:", adminUserName)
    const adminResponse = await oauthHelper.getStratoUserFromToken(adminCredentials.token)

    assert.strictEqual(
      adminResponse.status,
      RestStatus.OK,
      adminResponse.message
    )
    adminUser = { ...adminResponse.user, ...adminCredentials }
  })

   it('Should populate services', async () => {
    // let _dapp = await dappJs.uploadDappContract(adminUser, options)
    const deploy = fsUtil.getYaml(`${config.configDirPath}/${config.deployFilename}`)
    const options = { config }

    const _dapp = await dappJs.bind(adminUser, deploy.dapp.contract, {       
      ...options,
    })

    const result = await ServiceSeederJs.createServices(_dapp)
    assert(Array.isArray(result), 'result should be an array')
    assert.equal(result.length, ServiceJson.services.length)
  })

})

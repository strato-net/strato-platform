import { Spinner } from 'clui'
import { assert } from 'chai'
import { rest } from 'blockapps-rest'
import config from "../../load.config"
import oauthHelper from "../../helpers/oauthHelper"
import { getMembershipStates } from '/helpers/enums'
import { yamlWrite } from '/helpers/config'
import RestStatus from "http-status-codes"


import dappJs from "./dapp"
import membershipManagerJs from '/dapp/memberships/membershipManager'


const options = { config, logger: console }

describe("Marketplace Dapp - deploy secondary org", function() {
  this.timeout(config.timeout)
  
  let MembershipStates

  let adminCredentials
  let adminUser

  let dapp
  let orgCert
  let orgAddress
  let orgPubKey // I hate you

  let organizationManager
  let membershipManager
  let userManager
  

  before(async () => {
    assert.isDefined(
        config.configDirPath,
        "configDirPath is  missing. Set in config"
    )
    assert.isDefined(
        config.deployFilename,
        "deployFilename is missing. Set in config"
    )
    
    MembershipStates = await getMembershipStates()

    let serviceUserToken
    try {
      serviceUserToken = await oauthHelper.getServiceToken()
    } catch(e) {
      console.error("ERROR: Unable to fetch the service user token, check your OAuth settings in config", e)
      throw e
    }
    adminCredentials = { token: serviceUserToken }
    const adminEmail = oauthHelper.getEmailIdFromToken(adminCredentials.token)
    console.log("Creating admin", adminEmail)
    const adminResponse = await oauthHelper.createStratoUser(
      adminCredentials,
      adminEmail
    )
    assert.strictEqual(
      adminResponse.status,
      RestStatus.OK,
      adminResponse.message
    )
    adminUser = adminResponse.user
  })

  it('Load app from deploy file', async () => {
    dapp = await dappJs.loadFromDeployment(adminUser, `${config.configDirPath}/${config.deployFilename}`, options)
  })



})

import { assert, rest } from 'blockapps-rest'
import { util } from '/blockapps-rest-plus'
import dotenv from 'dotenv'
import config from '../../load.config'
import oauthHelper from '/helpers/oauthHelper'
import RestStatus from 'http-status-codes';
import { get, post, put } from '/helpers/rest'
import dappJs from '../../dapp/dapp/dapp'

import { userMembershipArgs, updateUserMembershipArgs } from './factories/userMembership'
import { UserMembership } from '../../api/v1/endpoints'
import {ROLE} from "../../helpers/constants"

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('User Membership End-To-End Tests', function () {
  this.timeout(config.timeout)
  let globalAdmin

  before(async () => {
    let globalAdminToken
    try {
      globalAdminToken = await oauthHelper.getUserToken(
        `${process.env.GLOBAL_ADMIN_NAME}`,
        `${process.env.GLOBAL_ADMIN_PASSWORD}`,
      )
    } catch (e) {
      console.error(
        'ERROR: Unable to fetch the  user token, check your OAuth settings in config',
        e,
      )
      throw e
    }

    const globalAdminCredentials = { token: globalAdminToken }

    const globalAdminResponse = await oauthHelper.getStratoUserFromToken(globalAdminCredentials.token)
    const dapp = await dappJs.loadFromDeployment(globalAdminCredentials, `${config.configDirPath}/${config.deployFilename}`, options);
    

    assert.strictEqual(
      globalAdminResponse.status,
      RestStatus.OK,
      globalAdminResponse.message
    )
    globalAdmin = { ...globalAdminResponse.user, ...globalAdminCredentials }

    // await dapp.managers.userMembershipManager.createUserMembership({
    //   appChainId:dapp.chainId,
    //   username:`${process.env.GLOBAL_ADMIN_NAME}`,
    //   userAddress:globalAdmin.address,
    //   role:ROLE.ADMIN
    // });
  
  })

  // it('Create a User Membership', async () => {
  //   const createArgs = {
  //     ...userMembershipArgs(util.uid(),globalAdmin.address),
  //   }

  //   const createResponse = await post(
  //     UserMembership.prefix,
  //     UserMembership.create,
  //     createArgs,
  //     globalAdmin.token,
  //   )

  //   assert.equal(createResponse.status, 200, 'should be 200');
  //   assert.isDefined(createResponse.body, 'body should be defined')
  // })

  // it('Get an User Membership', async () => {
  //   // create
  //   const createArgs = {
  //       ...userMembershipArgs(util.uid(),globalAdmin.address),
  //     }
  
  //     const createResponse = await post(
  //       UserMembership.prefix,
  //       UserMembership.create,
  //       createArgs,
  //       globalAdmin.token,
  //     )
  
  //     assert.equal(createResponse.status, 200, 'should be 200');
  //     assert.isDefined(createResponse.body, 'body should be defined')

  //   // get
  //   const userMembership = await get(
  //     UserMembership.prefix,
  //     UserMembership.get.replace(':address', createResponse.body.data[1]),
  //     {},
  //     globalAdmin.token,
  //   )

  //   const responseData = userMembership?.body.data

  //   assert.equal(userMembership.status, 200, 'should be 200');
  //   assert.isDefined(userMembership.body, 'body should be defined');

  // })

  it('Get all User Membership', async () => {
    // get
    const userMembership = await get(
      UserMembership.prefix,
      UserMembership.getAll,
      {},
      globalAdmin.token,
    )

    assert.equal(userMembership.status, 200, 'should be 200');
    assert.isDefined(userMembership.body, 'body should be defined');
    assert.isDefined(userMembership.body.data, 'body should be defined');
  })

  it('Get all Certfiers Membership', async () => {
    // get
    const certifiers = await get(
      UserMembership.prefix,
      UserMembership.getAllCertifiers,
      {},
      globalAdmin.token,
    )

    assert.equal(certifiers.status, 200, 'should be 200');
    assert.isDefined(certifiers.body, 'body should be defined');
    assert.isDefined(certifiers.body.data, 'body should be defined');
  })



})

import { rest, assert, util } from 'blockapps-rest-plus'
import config from '/load.config'
import dotenv from 'dotenv'

import { getOrganizationMembershipStates } from '/helpers/enums'
import constants from '/helpers/constants'
import oauthHelper from '/helpers/oauthHelper'
import { getCurrentEnode } from '/helpers/enodeHelper'

import factory from './organizationMembership.factory'
import organizationMembership from '../organizationMembership'

const options = { config }

const loadEnv = dotenv.config()
assert.isUndefined(loadEnv.error)

describe('OrganizationMembership', function () {
  this.timeout(config.timeout)

  const OrganizationMembershipState = getOrganizationMembershipStates()

  let user
  let enodeAddress

  before(async () => {
    let userToken
    try {
      userToken = await oauthHelper.getUserToken(`${process.env.ORGANIZATION_ADMIN_NAME}`, `${process.env.TEST_USER_PASSWORD}`)
    } catch (e) {
      console.error('ERROR: Unable to fetch the user token, check your OAuth settings in config', e)
      throw e
    }
    const userCredentials = { token: userToken }
    user = await rest.createUser(userCredentials, options)
    enodeAddress = getCurrentEnode()
  })

  it('Create OrganizationMembership', async () => {
    const args = {
      ...(factory.getOrganizationMembershipArgs(util.uid())),
      enodeAddress,
    }
    const contract = await organizationMembership.uploadContract(user, args, options)

    assert.notEqual(contract.address, constants.zeroAddress, 'Contract address must be not zero')

    const {
      organizationCommonName,
      requesterCommonName,
      state,
    } = await contract.getState()

    assert.equal(organizationCommonName, args.organizationCommonName, 'organizationCommonName')
    assert.equal(requesterCommonName, args.requesterCommonName, 'requesterUsername')
    assert.equal(OrganizationMembershipState[state], OrganizationMembershipState[OrganizationMembershipState.NEW], 'state')
  })

  describe('Set State', () => {
    let contract

    before(async () => {
      const args = {
        ...(factory.getOrganizationMembershipArgs(util.uid())),
        enodeAddress,
      }
      contract = await organizationMembership.uploadContract(user, args, options)
    })

    it('Set state - APPROVED', async () => {
      const args = { state: OrganizationMembershipState.ACCEPTED }
      await contract.setState(args)

      const { state } = await contract.getState()
      assert.equal(OrganizationMembershipState[state], OrganizationMembershipState[OrganizationMembershipState.ACCEPTED], 'state')
    })

    it('Set state - REJECTED', async () => {
      const args = { state: OrganizationMembershipState.REJECTED }
      await contract.setState(args)

      const { state } = await contract.getState()
      assert.equal(OrganizationMembershipState[state], OrganizationMembershipState[OrganizationMembershipState.REJECTED], 'state')
    })
  })
})

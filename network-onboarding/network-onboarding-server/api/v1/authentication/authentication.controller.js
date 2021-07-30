import jwtDecode from 'jwt-decode'
import { oauthUtil, rest } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import config from '/load.config'
import { getRoles, getOrgRoles } from '/helpers/enums'

import { setSearchQueryOptions, searchOne } from '/helpers/utils'
import oauthHelper from '/helpers/oauthHelper'
import constants from '/helpers/constants'

import dappJs from '/dapp/dapp/dapp'
import orgGovernanceJs from '/dapp/org-onboarding/dapp/orgGovernance'

const oauth = oauthUtil.init(config.nodes[0].oauth)
const options = { config }
const roles = getRoles()
const orgRoles = getOrgRoles()

class AuthenticationController {
  static async callback(req, res, next) {
    const { code } = req.query
    const { app } = req

    let address
    let username
    let accessToken
    let refreshToken
    let accessTokenExpiration

    try {
      const tokensResponse = await oauth.getAccessTokenByAuthCode(code)
      accessToken = tokensResponse.token[
        config.nodes[0].oauth.tokenField
          ? config.nodes[0].oauth.tokenField
          : 'access_token'
      ]
      const decodedToken = jwtDecode(accessToken)
      accessTokenExpiration = decodedToken.exp
      refreshToken = tokensResponse.token.refresh_token
      username = decodedToken.email
      try {
        address = await rest.getKey({ username, token: accessToken }, options)
      } catch (e) {
        // user isn't created in STRATO
        if (e.response && e.response.status === RestStatus.BAD_REQUEST) {
          const user = await rest.createUser({ username, token: accessToken }, options)
          address = user.address
        }
      }
    } catch (e) {
      rest.response.status(RestStatus.FORBIDDEN, res)
      return next()
    }

    res.cookie(oauth.getCookieNameAccessToken(), accessToken, {
      maxAge: config.nodes[0].oauth.appTokenCookieMaxAge,
      httpOnly: true,
    })
    res.cookie(oauth.getCookieNameAccessTokenExpiry(), accessTokenExpiration, {
      maxAge: config.nodes[0].oauth.appTokenCookieMaxAge,
      httpOnly: true,
    })
    res.cookie(oauth.getCookieNameRefreshToken(), refreshToken, {
      maxAge: config.nodes[0].oauth.appTokenCookieMaxAge,
      httpOnly: true,
    })

    // ----------------- USER ONBOARDING ------------------------

    const serviceUserToken = await oauthHelper.getServiceToken()

    // bind to serviceDapp
    const deploy = app.get(constants.deployParamName)
    const dapp = await dappJs.bind({ token: serviceUserToken }, deploy.dapp.contract, options)

    // search for this user on the main chain
    const searchArgs = setSearchQueryOptions({}, { key: 'username', value: username })
    const mainChainUser = await searchOne('CarbonUser', searchArgs, options, { token: serviceUserToken })

    // search this user on an org private chain (org admins will be on both, but not at first)
    const orgUser = await searchOne('OrgUser', searchArgs, options, { token: serviceUserToken })

    // no user exists
    if ((orgUser == undefined || orgUser.chainId == undefined) && mainChainUser == undefined) {
      res.redirect('/')
      return next()
    }

    // check if mainChainUser is "uninitialized" (has zero address).
    // If so, set the address, assign the role, create OrgUser if OrgAdmin
    if (mainChainUser !== undefined) {
      if (mainChainUser.blockchainAddress == 0) {
        // get the intended role, and set it
        const user = { username, address, accessToken }

        // NOTE:
        //  - If this is a network node, the service account is an org_admin.
        //    So it can't assign main chain permisions
        //    So, global admins operating on network nodes cannot create global admins

        // set role
        if (mainChainUser.role == roles.GLOBAL_ADMIN) {
          await dapp.grantGlobalAdminRole({ user })
        }
        if (mainChainUser.role == roles.ORG_ADMIN) {
          // if this is an org admin, we may need to create their OrgUser contract here 
          // (if they were created by global admin)
          //   first, get the org chainID by looking up the org contract address in the user contract
          if (mainChainUser.organization && orgUser === undefined) {
            const orgSearchArgs = setSearchQueryOptions({}, {
              key: 'address',
              value: mainChainUser.organization,
            })
            const org = await searchOne(
              'Organization',
              orgSearchArgs,
              options,
              { token: serviceUserToken },
            )
            const orgChainId = org.privateChainId

            //  now, create the OrgUser, set their blockchainAddress, set their OrgRole
            const orgDapp = await orgGovernanceJs.getContract({ token: serviceUserToken }, orgChainId)
            await orgDapp.createUser({ username, role: orgRoles.ORG_ADMIN })
            await orgDapp.setUserBlockchainAddress({ username, blockchainAddress: address }, options)
            await orgDapp.grantOrganizationAdminRole({ user })

          }
          // TODO: can't be done by service account unless blockapps-sol lets non-owner call grant
          await dapp.grantOrganizationAdminRole({ user })
        }

        // we only set the address if all of the above succeeds
        await dapp.setUserBlockchainAddress({ username, blockchainAddress: address }, options)
      }
    }

    // check if orgUser is "uninitialized" (has non-zero address).
    // If so, set the address, set the role
    if (orgUser !== undefined && orgUser.chainId !== undefined) {
      if (orgUser.blockchainAddress == 0) {
        // bind to the org chain dapp
        const govDapp = await orgGovernanceJs.getContract({ token: serviceUserToken }, orgUser.chainId)

        const user = { username, address, accessToken }

        if (orgUser.role == orgRoles.ORG_USER) {
          await govDapp.grantOrganizationUserRole({ user })
        }
        if (orgUser.role == orgRoles.ORG_ADMIN) {
          await govDapp.grantOrganizationAdminRole({ user })
        }

        // we only set the address if all of the above succedds
        await govDapp.setUserBlockchainAddress({ username, blockchainAddress: address }, options)
      }
    }

    res.redirect('/')

    return next()
  }

  static async logout(req, res) {
    const oauthSignOutUrl = oauth.getLogOutUrl()

    res.clearCookie(oauth.getCookieNameAccessToken())
    res.clearCookie(oauth.getCookieNameAccessTokenExpiry())
    res.clearCookie(oauth.getCookieNameRefreshToken())

    rest.response.status200(res, { logoutUrl: oauthSignOutUrl })
  }
}

export default AuthenticationController

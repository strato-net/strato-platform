import { rest } from 'blockapps-rest'
import config from '../../../load.config'
import { pollingHelper } from '../../../helpers/utils'

const options = { config, cacheNonce: true }

class UsersController {
  static async me(req, res, next) {
    try {
      const { dapp, accessToken, decodedToken, address: userAddress } = req
      const username = decodedToken.preferred_username
      let user = null
      if (Object.hasOwn(dapp, 'hasCert')) user = dapp.hasCert;
      if (user === null || user === undefined) {
        user = await pollingHelper(dapp.getCertificate, [{ userAddress }]);
        // user = await dapp.getCertificate({ userAddress })
        if (user === null || user === undefined) console.log('user not found in after multiple attempts');
      }
      console.debug('me USER ', user);
      if (!user || Object.keys(user).length == 0) {
        rest.response.status400(res, { username })
      }
      else {
        // search for user wallet TODO: clean this up
        const searchOptions = {...options, query: {authorizedSeller: 'not.is.null', commonName: `eq.${user.commonName}`, limit: 1}}
        let walletResp = await rest.search(accessToken, {name: 'BlockApps-UserRegistry-User'}, searchOptions)
        console.log('AYA LOGS - walletResp', walletResp)
        rest.response.status200(res, {
          ...user,
          email: decodedToken.email,
          preferred_username: decodedToken.preferred_username,
          authorizedSeller: walletResp[0].authorizedSeller
        })
      }
      return next()
    } catch (e) {
      return next(e)
    }
  }


  static async get(req, res, next) {
    try {
      const { dapp, query } = req
      const { address } = query
      const user = await dapp.getCertificate({
        userAddress: address,
      })

      if (!user || Object.keys(user).length == 0) {
        rest.response.status(404, res, { address })
      }
      else {
        rest.response.status200(res, user)
      }
      return next()
    } catch (e) {
      return next(e)
    }
  }


  static async getAll(req, res, next) {
    try {
      const { dapp } = req

      const users = await dapp.getCertificates();
      return rest.response.status200(res, users)
    } catch (e) {
      return next(e)
    }
  }

}

export default UsersController

import { rest } from 'blockapps-rest'
import { RestError } from 'blockapps-rest/dist/util/rest.util'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class UsersController {
  static async me(req, res, next) {
    try {
      const { dapp, accessToken, decodedToken, address: userAddress } = req
      const username = decodedToken.preferred_username
      let user = null
      if (Object.hasOwn(dapp, 'hasCert')) user = dapp.hasCert;
      if (user === null || user === undefined) {
        user = await dapp.getCertificate({ userAddress })

        console.log('me USER ', user)
        if (user === null || user === undefined) { 
            console.log('user not found in first attempt')
            await new Promise(resolve => setTimeout(resolve, 3000));
            user = await dapp.getCertificate({ userAddress })
            console.log('user content from second attempt', user)
        }
      }
      if (!user || Object.keys(user).length == 0) {
        rest.response.status400(res, { username }) 
      }
      else {
        rest.response.status200(res, {
          ...user,
          preferred_username: decodedToken.preferred_username,
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

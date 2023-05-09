import { rest } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import dappJs from '/dapp/dapp/dapp'
import constants from '../../helpers/constants'
import config from '/load.config'
import oauthHelper from '/helpers/oauthHelper'

const options = { config }

const loadDapp = async (req, res, next) => {
  const { app, username } = req
  const accessToken = { token: req.headers['x-user-access-token'] };
  const userCredentials = {
    username,
    ...accessToken,
  }
  // console.log('req: \n\n\n\n\n', req)
  console.log('userCredentials: \n\n\n\n\n', userCredentials)
  let address

  // For public use...If there is no accessToken use the serviceUserToken to handle the request. 
  if (!accessToken) {
    const serviceUserToken = await oauthHelper.getServiceToken()
    const deploy = app.get(constants.deployParamName)

    req.dapp = await dappJs.bind({ token: serviceUserToken }, deploy.dapp.contract, options)

    return next()

  } else {

    try {
      address = await rest.getKey(userCredentials, options)
    } catch (e) {
      // user isn't created in STRATO
      if (e.response.status === RestStatus.BAD_REQUEST) {
        rest.response.status(RestStatus.FORBIDDEN, res)
        return next()
      }

      // unexpected error
      return next(e)
    }

    const user = {
      ...userCredentials,
      node: config.nodes[0],
      address,
    }

    const deploy = app.get(constants.deployParamName)

    req.user = user
    req.dapp = await dappJs.bind(user, deploy.dapp.contract, {
      chainIds: [deploy.dapp.contract.appChainId],
      ...options
    })

    return next()
  }
}

export default loadDapp

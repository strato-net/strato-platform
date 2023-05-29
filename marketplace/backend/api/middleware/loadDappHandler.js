import { rest } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import dappJs from '/dapp/dapp/dapp'
import constants from '../../helpers/constants'
import config from '/load.config'
import oauthHelper from '/helpers/oauthHelper'
import jwtDecode from 'jwt-decode'

const options = { config }

const loadDapp = async (req, res, next) => {
  const { app, username, accessToken } = req

  const userCredentials = {
    username,
    ...accessToken,
  }
  console.log('req: \n\n\n\n\n', req)

  let address

    // For public use...If there is no accessToken use the serviceUserToken to handle the request. 
    // if (accessToken === undefined) {
    //   const serviceUserToken = await oauthHelper.getServiceToken()
    //   const deploy = app.get(constants.deployParamName)

    //   const serviceUserCredentials = {
    //     username: 'serviceUser',
    //     token: serviceUserToken,
    //   }

    //   try {
    //     address = await rest.getKey(serviceUserCredentials, options)
    //   } catch (e) {
    //     // user isn't created in STRATO
    //     if (e.response.status === RestStatus.BAD_REQUEST) {
    //       rest.response.status(RestStatus.FORBIDDEN, res)
    //       return next()
    //     }
        
    //     // unexpected error
    //     return next(e)
    //   }

    //   const user = {
    //     ...serviceUserCredentials,
    //     node: config.nodes[0],
    //     address,
    //   }

    //   const decodedToken = jwtDecode(serviceUserToken)
      
    //   console.log("user: \n\n\n\n\n", user)

    //   req.user = user
    //   req.username = decodedToken.preferred_username
    //   req.address = address
    //   req.decodedToken = decodedToken
    //   req.accessToken = {token: serviceUserToken}
    //   req.dapp = await dappJs.bind(user, deploy.dapp.contract, {
    //     chainIds: [deploy.dapp.contract.appChainId],
    //     ...options
    //   })

    
    //   return next()
  
    // } else {
  
    try {
      address = await rest.getKey(userCredentials, options);
    } catch (e) {
      // user isn't created in STRATO
      if (e.response && e.response.status === RestStatus.BAD_REQUEST) {
        rest.response.status(RestStatus.FORBIDDEN, res);
        // return next(); I don't think this is needed since we want to create the user if it doesn't exist?
      }
    
      // create new user
      try {
        address = await rest.createKey(userCredentials, options);
      } catch (e) {
        console.error("Error in createKey:", e);
        // Better error handling here?
      }
    }
    // TODO: if there are multiple simultaneous calls made to different endpoints (by a browser when the page loads),
    //       then these lines can be hit multiple times at the same time.
    //       So when you try to createKey, it is possible that it was already 
    //       created in the same moment of time by another thread. So the exception here in such case should not fail the app
    
  
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
    // }
  }
  
  export default loadDapp

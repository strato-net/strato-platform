import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'

const options = { config, cacheNonce: true }

class OrderLineController {

  static async get(req, res, next) {
    try {
      const { dapp, params } = req
      const { address, chainId } = params 
     
      let args
      let chainOptions = options
      
      if (address) {
        args = { address }
        // if (chainId) {
        //   chainOptions = { ...options, chainIds: [chainId] }
        // }
      }

      const result = await dapp.getOrderLine(args, chainOptions)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }



  
}

export default OrderLineController

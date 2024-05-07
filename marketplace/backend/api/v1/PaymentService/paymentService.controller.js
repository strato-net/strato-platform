import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'

class PaymentServiceController {

  static async stripeOnboarding(req, res, next) {
    try {
      const { dapp } = req

      const originUrl = req.headers.origin;

      const result = await dapp.stripeOnboarding(originUrl);
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async stripeOnboardingStatus(req, res, next) {
    try {
      const { dapp, params } = req

      const result = await dapp.getPaymentServices(params)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

}


export default PaymentServiceController
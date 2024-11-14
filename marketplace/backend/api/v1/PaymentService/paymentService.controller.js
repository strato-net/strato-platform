import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';

class PaymentServiceController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;
      const { onlyActive } = query;

      const result = await dapp.getPaymentServices({ onlyActive: onlyActive });
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getNotOnboarded(req, res, next) {
    try {
      const { dapp, query } = req;

      const result = await dapp.getNotOnboardedPaymentServices(query);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default PaymentServiceController;

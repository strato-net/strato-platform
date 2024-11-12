import { rest } from "blockapps-rest";
import Joi from "@hapi/joi";
import RestStatus from "http-status-codes";

class GovernanceController {
  static async get(_, res, next) {
    try {
      const result = await dapp.getGovernance();
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async stake(req, res, next) {
    try {
      const { dapp, query } = req;

      const result = await dapp.getPaymentServices(query);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async unstake(req, res, next) {
    try {
      const { dapp, query } = req;

      const result = await dapp.unstake(query);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default GovernanceController;

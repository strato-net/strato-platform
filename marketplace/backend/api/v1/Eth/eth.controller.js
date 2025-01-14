import { rest } from 'blockapps-rest';
import EthJs from '../../../dapp/items/eth';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';

class EthController {
  //   static async getETHSTBalance(req, res, next) {
  //     try {
  //       const { dapp, address: userAddress } = req;
  //       let stratsBalance = 0;

  //       stratsBalance = await dapp.getStratsBalance({ userAddress: userAddress });

  //       return rest.response.status200(res, stratsBalance);
  //     } catch (e) {
  //       return next(e);
  //     }
  //   }

  static async getETHSTAddress(_, res, next) {
    try {
      const address = await EthJs.getETHSTAddress();

      return rest.response.status200(res, address);
    } catch (e) {
      return next(e);
    }
  }

  static async getWBTCSTAddress(_, res, next) {
    try {
      const address = await EthJs.getWBTCSTAddress();

      return rest.response.status200(res, address);
    } catch (e) {
      return next(e);
    }
  }

  static async addHash(req, res, next) {
    try {
      const { dapp, body } = req;

      EthController.validateAddHashArgs(body);

      const result = await dapp.addHash(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static validateAddHashArgs(args) {
    const addHashSchema = Joi.object({
      userAddress: Joi.string().required(),
      txHash: Joi.string().required(),
      amount: Joi.string().required(),
    });

    const validation = addHashSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Add Hash Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default EthController;

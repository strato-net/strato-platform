import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

class MembershipController {
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const memberships = await dapp.getMemberships({ ...query });
      rest.response.status200(res, memberships);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      MembershipController.validateCreateMembershipArgs(body);

      const result = await dapp.createMembership(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateMembershipArgs(args) {
    const createMembershipSchema = Joi.object({
      itemArgs: Joi.object({
        serialNumber: Joi.string().allow('').optional(),
        name: Joi.string().required(),
        description: Joi.string().required(),
        expirationPeriodInMonths: Joi.number().integer().min(1).required(),
        quantity: Joi.number().integer().min(1).required(),
        images: Joi.array().items(Joi.string().allow(null)).required(),
        files: Joi.array().items(Joi.string().allow(null)).required(),
        fileNames: Joi.array().items(Joi.string().allow(null)).required(),
        redemptionService: Joi.string().required(),
      }).required(),
    });

    const validation = createMembershipSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Membership Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default MembershipController;

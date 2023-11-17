import { rest } from "blockapps-rest";
import Joi from "@hapi/joi";
import RestStatus from "http-status-codes";
import config from "../../../load.config";

const options = { config, cacheNonce: true };

class ServiceUsageController {
  static async get(req, res, next) {
    try {
      const { dapp, params } = req;
      const { address, chainId } = params;

      let args;
      let chainOptions = options;

      if (address) {
        args = { address };
        if (chainId) {
          chainOptions = { ...options, chainIds: [chainId] };
        }
      }

      const result = await dapp.getServiceUsage(args, chainOptions);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const serviceUsages = await dapp.getServiceUsage({ ...query });
      rest.response.status200(res, serviceUsages);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAllBooked(req, res, next) {
    try {
      const { dapp, query } = req;
      const bookedServiceUsages = await dapp.getBookedServiceUsage({ ...query });
      rest.response.status200(res, bookedServiceUsages);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAllProvided(req, res, next) {
    try {
      const { dapp, query } = req;

      const providedServiceUsages = await dapp.getProvidedServiceUsages({ ...query });
      rest.response.status200(res, providedServiceUsages);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      ServiceUsageController.validateCreateServiceUsageArgs(body);

      const result = await dapp.createServiceUsage(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async update(req, res, next) {
    try {
      const { dapp, body } = req;

      ServiceUsageController.validateUpdateServiceUsageArgs(body);

      const result = await dapp.updateServiceUsage(body, options);

      rest.response.status200(res, result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreateServiceUsageArgs(args) {
    console.log('args: ', args)
    const createServiceUsageSchema = Joi.object({
      itemId: Joi.string().required(),
      serviceId: Joi.string().required(),
      serviceDate: Joi.string().required(),
      summary: Joi.string().required(),
      status: Joi.number().required(),
      paymentStatus: Joi.number().required(),
      providerLastUpdated: Joi.string().required(),
      providerComment: Joi.string().required(),
      providerLastUpdatedDate: Joi.string().required(),
      pricePaid: Joi.string().required(),
      bookedUserAddress: Joi.string().required(),
      providerOrg: Joi.string().required()
    });

    const validation = createServiceUsageSchema.validate(args);

    if (validation.error) {
      console.log("validation.error: ", validation.error);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `Create ServiceUsage Argument Validation Error`,
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateUpdateServiceUsageArgs(args) {
    const updateServiceUsageSchema = Joi.object({
      address: Joi.string().required(),
      updates: Joi.object({
        serviceDate: Joi.string(),
        summary: Joi.string(),
        status: Joi.number(),
        paymentStatus: Joi.number(),
        providerLastUpdated: Joi.string(),
        providerComment: Joi.string(),
        providerLastUpdatedDate: Joi.string(),
        pricePaid: Joi.string(),
      }).required(),
    });

    const validation = updateServiceUsageSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `Update ServiceUsage Argument Validation Error`,
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default ServiceUsageController;

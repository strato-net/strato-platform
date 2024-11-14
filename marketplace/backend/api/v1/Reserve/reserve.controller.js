import { rest } from "blockapps-rest";
import Joi from "@hapi/joi";
import RestStatus from "http-status-codes";

class ReserveController {
  // Retrieve reserve contract Address
  static async get(req, res, next) {
    try {
      const { dapp } = req;
      const result = await dapp.getReserve();
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // Calculate staking preview
  static async calculate(req, res, next) {
    try {
      const { dapp, body } = req;
      ReserveController.validateCalculateArgs(body);

      const result = await dapp.calculate(body);
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // Stake in the reserve system
  static async stake(req, res, next) {
    try {
      const { dapp, body } = req;
      ReserveController.validateStakeArgs(body);

      const result = await dapp.stake(body);
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // Unstake from the reserve system
  static async unstake(req, res, next) {
    try {
      const { dapp, body } = req;
      ReserveController.validateUnstakeArgs(body);

      const result = await dapp.unstake(body);
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // ----------------------- ARGUMENT VALIDATION ------------------------

  static validateCalculateArgs(args) {
    const schema = Joi.object({
      assetAmount: Joi.number().positive().required().messages({
        "any.required": "Amount is required and must be a number.",
        "number.base": "Amount must be a valid number.",
        "number.positive": "Amount must be a positive number.",
      }),
      assetAddress: Joi.string().required().messages({
        "any.required": "Asset Address is required and must be a string.",
        "string.base": "Asset Address must be a valid string.",
      }),
      reserve: Joi.string().required().messages({
        "any.required": "Reserve is required and must be a string.",
        "string.base": "Reserve must be a valid string.",
      }),
    });
    ReserveController.validateArgs(args, schema, "Calculate");
  }

  static validateStakeArgs(args) {
    const schema = Joi.object({
      assetAmount: Joi.number().positive().required().messages({
        "any.required": "Amount is required and must be a positive number.",
        "number.base": "Amount must be a valid number.",
        "number.positive": "Amount must be a positive number.",
      }),
      assetAddress: Joi.string().required().messages({
        "any.required": "Asset Address is required and must be a string.",
        "string.base": "Asset Address must be a valid string.",
      }),
      stratsPaymentService: Joi.object({
            creator: Joi.string().required(),
            serviceName: Joi.string().required(),
        }).required(),
      reserve: Joi.string().required().messages({
        "any.required": "Reserve is required and must be a string.",
        "string.base": "Reserve must be a valid string.",
      }),
    });
    ReserveController.validateArgs(args, schema, "Stake");
  }

  static validateUnstakeArgs(args) {
    const schema = Joi.object({
      escrow: Joi.string().required().messages({
        "any.required": "Escrow is required and must be a string.",
        "string.base": "Escrow must be a valid string.",
      }),
      stratsPaymentService: Joi.string().required().messages({
        "any.required":
          "Strats Payment Service is required and must be a string.",
        "string.base": "Strats Payment Service must be a valid string.",
      }),
    });
    ReserveController.validateArgs(args, schema, "Unstake");
  }

  static validateArgs(args, schema, action) {
    const { error } = schema.validate(args);
    if (error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `${action} Argument Validation Error`,
        { message: `Invalid arguments: ${error.message}` }
      );
    }
  }
}

export default ReserveController;

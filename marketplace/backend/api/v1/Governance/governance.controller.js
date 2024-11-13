import { rest } from "blockapps-rest";
import Joi from "@hapi/joi";
import RestStatus from "http-status-codes";

class GovernanceController {
  // Retrieve governance contract Address
  static async get(_, res, next) {
    try {
      const result = await dapp.getGovernance();
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // Calculate staking preview
  static async calculate(req, res, next) {
    try {
      const { dapp, query } = req;
      GovernanceController.validateCalculateArgs(query);

      const result = await dapp.calculate(query);
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // Stake in the governance system
  static async stake(req, res, next) {
    try {
      const { dapp, body } = req;
      GovernanceController.validateStakeArgs(body);

      const result = await dapp.getPaymentServices(body);
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // Unstake from the governance system
  static async unstake(req, res, next) {
    try {
      const { dapp, body } = req;
      GovernanceController.validateUnstakeArgs(body);

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
      amount: Joi.number().positive().required().messages({
        "any.required": "Amount is required and must be a number.",
        "number.base": "Amount must be a valid number.",
        "number.positive": "Amount must be a positive number.",
      }),
      assetAddress: Joi.string().required().messages({
        "any.required": "Asset Address is required and must be a string.",
        "string.base": "Asset Address must be a valid string.",
      }),
    });
    GovernanceController.validateArgs(args, schema, "Calculate");
  }

  static validateStakeArgs(args) {
    const schema = Joi.object({
      amount: Joi.number().positive().required().messages({
        "any.required": "Amount is required and must be a positive number.",
        "number.base": "Amount must be a valid number.",
        "number.positive": "Amount must be a positive number.",
      }),
      assetAddress: Joi.string().required().messages({
        "any.required": "Asset Address is required and must be a string.",
        "string.base": "Asset Address must be a valid string.",
      }),
      stratsPaymentService: Joi.string().required().messages({
        "any.required":
          "Strats Payment Service is required and must be a string.",
        "string.base": "Strats Payment Service must be a valid string.",
      }),
    });
    GovernanceController.validateArgs(args, schema, "Stake");
  }

  static validateUnstakeArgs(args) {
    const schema = Joi.object({
      strats: Joi.array().items(Joi.string()).required().messages({
        "any.required": "Strats must be provided as an array of strings.",
        "array.base": "Strats must be an array.",
        "array.includes": "Each strat must be a valid string.",
      }),
      escrow: Joi.string().required().messages({
        "any.required": "Escrow is required and must be a string.",
        "string.base": "Escrow must be a valid string.",
      }),
    });
    GovernanceController.validateArgs(args, schema, "Unstake");
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

export default GovernanceController;

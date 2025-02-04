import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';

class ReserveController {
  // Retrieve reserve contract using address
  static async get(req, res, next) {
    try {
      const { dapp, params } = req;
      const { address } = params;

      // Validate address presence and type
      ReserveController.validateGetArgs({ address });

      const result = await dapp.getReserve(address);
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // Retrieve all reserve contracts
  static async getAll(req, res, next) {
    try {
      const { dapp } = req;
      const result = await dapp.getAllReserve();
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // Calculate borrow preview
  static async oraclePrice(req, res, next) {
    try {
      const { dapp, params } = req;
      const { address } = params;

      // Validate address presence and type
      ReserveController.validateGetArgs({ address });

      const result = await dapp.oraclePrice(address);
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

  // Borrow USDST from reserve
  static async borrow(req, res, next) {
    try {
      const { dapp, body } = req;
      ReserveController.validateBorrowArgs(body);

      const result = await dapp.borrow(body);
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  // Pay USDST Loan to reserve
  static async repay(req, res, next) {
    try {
      const { dapp, body } = req;
      ReserveController.validateRepayArgs(body);
      const { escrows, ...restBody } = body;
      const results = [];
      for (const escrow of escrows) {
        const result = await dapp.repay({ escrow, ...restBody });
        results.push(result);
      }
      rest.response.status200(res, results);
      next();
    } catch (e) {
      next(e);
    }
  }

  // ----------------------- ARGUMENT VALIDATION ------------------------
  static validateGetArgs(args) {
    const schema = Joi.object({
      address: Joi.string().required().messages({
        'any.required': 'Address is required and must be a string.',
        'string.base': 'Address must be a valid string.',
      }),
    });
    ReserveController.validateArgs(args, schema, 'Get');
  }

  static validateCalculateBorrowArgs(args) {
    const schema = Joi.object({
      assetAmount: Joi.number().positive().required().messages({
        'any.required': 'Amount is required and must be a positive number.',
        'number.base': 'Amount must be a valid number.',
        'number.positive': 'Amount must be positive.',
      }),
      loanToValueRatio: Joi.number().positive().required().messages({
        'any.required':
          'loanToValueRatio is required and must be a positive number.',
        'number.base': 'loanToValueRatio must be a valid number.',
        'number.positive': 'loanToValueRatio must be positive.',
      }),
      oracleAddress: Joi.string().required().messages({
        'any.required': 'Oracle Address is required and must be a string.',
        'string.base': 'Oracle Address must be a valid string.',
      }),
    });
    ReserveController.validateArgs(args, schema, 'Calculate');
  }

  static validateStakeArgs(args) {
    const schema = Joi.object({
      collateralQuantity: Joi.string().pattern(/^\d+$/).required().messages({
        'any.required': 'Collateral Quantity is required and must be a string.',
        'string.base': 'Collateral Quantity must be a valid string.',
        'string.pattern.base': 'Collateral Quantity must be a valid number.',
      }),
      escrowAddress: Joi.string().optional(),
      assets: Joi.array().items(Joi.string()).required().messages({
        'any.required': 'assets is required and must be a string array.',
        'string.base': 'assets must be a valid string array.',
      }),
      reserve: Joi.string().required().messages({
        'any.required': 'Reserve is required and must be a string.',
        'string.base': 'Reserve must be a valid string.',
      }),
    });
    ReserveController.validateArgs(args, schema, 'Stake');
  }

  static validateUnstakeArgs(args) {
    const schema = Joi.object({
      quantity: Joi.string().pattern(/^\d+$/).required().messages({
        'any.required': 'Quantity is required and must be a string.',
        'string.base': 'Quantity must be a valid string.',
        'string.pattern.base': 'Quantity must be a valid number.',
      }),
      escrowAddresses: Joi.array().items(Joi.string()).required().messages({
        'array.base': 'escrowAddresses must be an array of strings.',
        'string.base': 'Each escrowAddress must be a valid string.',
        }),
      reserve: Joi.string().required().messages({
        'any.required': 'Reserve is required and must be a string.',
        'string.base': 'Reserve must be a valid string.',
      }),
    });
    ReserveController.validateArgs(args, schema, 'Unstake');
  }

  static validateBorrowArgs(args) {
    const schema = Joi.object({
      escrowAddresses: Joi.array().items(Joi.string()).required().messages({
        'any.required': 'Escrow Addresses are required and must be an array of strings.',
        'array.base': 'Escrow Addresses must be an array.',
        'string.base': 'Each Escrow Address must be a valid string.',
      }),
      borrowAmount: Joi.string().pattern(/^\d+$/).required(),
      reserve: Joi.string().required().messages({
        'any.required': 'Reserve is required and must be a string.',
        'string.base': 'Reserve must be a valid string.',
      }),
    });
    ReserveController.validateArgs(args, schema, 'Borrow');
  }

  static validateRepayArgs(args) {
    const schema = Joi.object({
      escrows: Joi.array().items(Joi.string()).required().messages({
        'any.required':
          'Escrow Addresses are required and must be an array of strings.',
        'array.base': 'Escrow Addresses must be an array.',
        'string.base': 'Each Escrow Address must be a valid string.',
      }),
      reserve: Joi.string().required().messages({
        'any.required': 'Reserve is required and must be a string.',
        'string.base': 'Reserve must be a valid string.',
      }),
    });
    ReserveController.validateArgs(args, schema, 'Repay');
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

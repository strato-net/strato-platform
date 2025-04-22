/**
 * @fileoverview Reserve Controller
 * 
 * This module handles the business logic for reserve operations in the marketplace,
 * including retrieving reserve information, staking assets, borrowing against
 * collateral, and repaying loans. Reserve contracts are a core component of the
 * DeFi ecosystem within the STRATO Mercata Marketplace, allowing users to
 * leverage their assets.
 * 
 * The reserve system implements collateralized lending, where users stake assets
 * as collateral and can borrow tokens against that collateral based on 
 * loan-to-value ratios and current oracle prices.
 * 
 * @module api/v1/Reserve/ReserveController
 * @see module:api/v1/Reserve
 */

import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';

/**
 * Controller class for handling reserve-related operations
 * 
 * @class ReserveController
 */
class ReserveController {
  /**
   * Retrieves a specific reserve contract by its blockchain address
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.address - Blockchain address of the reserve contract
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns reserve contract details or passes error to next middleware
   * @throws {RestError} - If the address is invalid or the reserve doesn't exist
   * @see GET /reserve/{address}
   */
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

  /**
   * Retrieves all reserve contracts in the system
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns array of all reserve contracts or passes error to next middleware
   * @throws {RestError} - If there's an error retrieving reserve contracts
   * @see GET /reserve
   */
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

  /**
   * Fetches information about CATA token rewards in the system
   * 
   * Retrieves data about the total CATA rewards available, claimable rewards,
   * and current reward rates.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns CATA rewards information or passes error to next middleware
   * @throws {RestError} - If there's an error retrieving reward information
   * @see GET /reserve/fetchTotalCataRewards
   */
  static async fetchTotalCataRewards(req, res, next) {
    try {
      const { dapp } = req;
      const result = await dapp.fetchTotalCataRewards();
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  /**
   * Retrieves price information from a specific oracle
   * 
   * Oracles provide price feeds for assets that are used to calculate 
   * collateral values and borrowing limits in the reserve system.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.address - Blockchain address of the oracle contract
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns oracle price information or passes error to next middleware
   * @throws {RestError} - If the address is invalid or the oracle doesn't exist
   * @see GET /reserve/oraclePrice/{address}
   */
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

  /**
   * Stakes assets as collateral in a reserve contract
   * 
   * Staking allows users to use their assets as collateral for borrowing.
   * The staked assets are locked in an escrow contract until they are
   * unstaked or the loan is repaid.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.collateralQuantity - Quantity of assets to stake as collateral (string representation of a number)
   * @param {string} [req.body.escrowAddress] - Optional address of an existing escrow contract
   * @param {Array<string>} req.body.assets - Array of blockchain addresses of assets to stake
   * @param {string} req.body.reserve - Blockchain address of the reserve contract
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns staking result or passes error to next middleware
   * @throws {RestError} - If validation fails or there's an error staking assets
   * @see POST /reserve/stake
   */
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

  /**
   * Stakes assets that have been bridged from another blockchain
   * 
   * This specialized staking operation is used when assets have been
   * transferred (bridged) from another blockchain and need to be
   * staked in the reserve system.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.stakeQuantity - Quantity to stake (string representation of a number)
   * @param {string} req.body.ownerCommonName - Common name of the owner of the assets
   * @param {string} req.body.assetAddress - Blockchain address of the asset to stake
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns staking result or passes error to next middleware
   * @throws {RestError} - If validation fails or there's an error staking assets
   * @see POST /reserve/stakeAfterBridge
   */
  static async stakeAfterBridge(req, res, next) {
    try {
      const { dapp, body } = req;
      ReserveController.validateStakeAfterBridgeArgs(body);

      const result = await dapp.stakeAfterBridge(body);
      rest.response.status200(res, result);
      next();
    } catch (e) {
      next(e);
    }
  }

  /**
   * Unstakes assets from a reserve contract
   * 
   * Unstaking removes assets from being used as collateral, freeing them
   * up for other uses. Assets can only be unstaked if there is no
   * outstanding loan against them or if sufficient collateral remains.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.quantity - Quantity to unstake (string representation of a number)
   * @param {Array<string>} req.body.escrowAddresses - Array of escrow addresses containing staked assets
   * @param {string} req.body.reserve - Blockchain address of the reserve contract
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns unstaking result or passes error to next middleware
   * @throws {RestError} - If validation fails or there's an error unstaking assets
   * @see POST /reserve/unstake
   */
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

  /**
   * Borrows tokens from a reserve contract using staked assets as collateral
   * 
   * The maximum amount that can be borrowed is determined by the value of
   * the collateral (based on oracle prices) and the loan-to-value ratio
   * of the reserve contract.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {Array<string>} req.body.escrowAddresses - Array of escrow addresses to use as collateral
   * @param {string} req.body.borrowAmount - Amount to borrow (string representation of a number)
   * @param {string} req.body.reserve - Blockchain address of the reserve contract
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns borrowing result or passes error to next middleware
   * @throws {RestError} - If validation fails, borrowing limit is exceeded, or there's an error borrowing
   * @see POST /reserve/borrow
   */
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

  /**
   * Repays a loan taken from a reserve contract
   * 
   * Repaying a loan reduces the debt on the collateral, potentially allowing
   * more borrowing capacity or the ability to unstake assets. This method
   * processes multiple escrow repayments in a single request.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {Array<string>} req.body.escrows - Array of escrow addresses for which to repay loans
   * @param {string} req.body.reserve - Blockchain address of the reserve contract
   * @param {string} req.body.value - Amount to repay (string representation of a number)
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns array of repayment results or passes error to next middleware
   * @throws {RestError} - If validation fails or there's an error repaying the loan
   * @see POST /reserve/repay
   */
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
  
  /**
   * Validates get operation arguments
   * 
   * Ensures that the address parameter is present and is a string.
   * 
   * @param {Object} args - Arguments to validate
   * @param {string} args.address - Blockchain address to validate
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
  static validateGetArgs(args) {
    const schema = Joi.object({
      address: Joi.string().required().messages({
        'any.required': 'Address is required and must be a string.',
        'string.base': 'Address must be a valid string.',
      }),
    });
    ReserveController.validateArgs(args, schema, 'Get');
  }

  /**
   * Validates calculate borrow operation arguments
   * 
   * Ensures that all required parameters for calculating borrowing capacity
   * are present and have valid types.
   * 
   * @param {Object} args - Arguments to validate
   * @param {number} args.assetAmount - Amount of the asset
   * @param {number} args.loanToValueRatio - Maximum loan-to-value ratio
   * @param {string} args.oracleAddress - Address of the price oracle contract
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
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

  /**
   * Validates stake operation arguments
   * 
   * Ensures that all required parameters for staking assets as collateral
   * are present and have valid types.
   * 
   * @param {Object} args - Arguments to validate
   * @param {string} args.collateralQuantity - Quantity to stake (string representation of a number)
   * @param {string} [args.escrowAddress] - Optional address of an existing escrow contract
   * @param {Array<string>} args.assets - Array of asset addresses to stake
   * @param {string} args.reserve - Address of the reserve contract
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
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

  /**
   * Validates stake after bridge operation arguments
   * 
   * Ensures that all required parameters for staking bridged assets
   * are present and have valid types.
   * 
   * @param {Object} args - Arguments to validate
   * @param {string} args.stakeQuantity - Quantity to stake (string representation of a number)
   * @param {string} args.ownerCommonName - Common name of the asset owner
   * @param {string} args.assetAddress - Address of the asset to stake
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
  static validateStakeAfterBridgeArgs(args) {
    const schema = Joi.object({
      stakeQuantity: Joi.string().pattern(/^\d+$/).required().messages({
        'any.required': 'Stake Quantity is required and must be a string.',
        'string.base': 'Stake Quantity must be a valid string.',
        'string.pattern.base': 'Stake Quantity must be a valid number.',
      }),
      ownerCommonName: Joi.string().required(),
      assetAddress: Joi.string().required(),
    });
    ReserveController.validateArgs(args, schema, 'Stake');
  }

  /**
   * Validates unstake operation arguments
   * 
   * Ensures that all required parameters for unstaking assets
   * are present and have valid types.
   * 
   * @param {Object} args - Arguments to validate
   * @param {string} args.quantity - Quantity to unstake (string representation of a number)
   * @param {Array<string>} args.escrowAddresses - Array of escrow addresses containing staked assets
   * @param {string} args.reserve - Address of the reserve contract
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
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

  /**
   * Validates borrow operation arguments
   * 
   * Ensures that all required parameters for borrowing tokens
   * are present and have valid types.
   * 
   * @param {Object} args - Arguments to validate
   * @param {Array<string>} args.escrowAddresses - Array of escrow addresses to use as collateral
   * @param {string} args.borrowAmount - Amount to borrow (string representation of a number)
   * @param {string} args.reserve - Address of the reserve contract
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
  static validateBorrowArgs(args) {
    const schema = Joi.object({
      escrowAddresses: Joi.array().items(Joi.string()).required().messages({
        'any.required':
          'Escrow Addresses are required and must be an array of strings.',
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

  /**
   * Validates repay operation arguments
   * 
   * Ensures that all required parameters for repaying loans
   * are present and have valid types.
   * 
   * @param {Object} args - Arguments to validate
   * @param {Array<string>} args.escrows - Array of escrow addresses for which to repay loans
   * @param {string} args.reserve - Address of the reserve contract
   * @param {string} args.value - Amount to repay (string representation of a number)
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
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
      value: Joi.string().pattern(/^\d+$/).required(),
    });
    ReserveController.validateArgs(args, schema, 'Repay');
  }

  /**
   * Generic argument validation method
   * 
   * Validates arguments against a Joi schema and throws a standardized
   * REST error if validation fails.
   * 
   * @param {Object} args - Arguments to validate
   * @param {Object} schema - Joi schema to validate against
   * @param {string} action - Name of the action being validated (for error messages)
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
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

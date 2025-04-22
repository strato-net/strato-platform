/**
 * @fileoverview Tokens Controller Module
 * @description Controller for managing token operations in the STRATO Mercata Marketplace.
 * This controller handles token creation, hash addition, token bridging, and retrieving
 * bridgeable tokens. Each method includes validation for request parameters.
 */

import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import tokensJs from '../../../dapp/items/tokens';

/**
 * @class TokensController
 * @description Controller class for handling token-related operations
 */
class TokensController {

  /**
   * @method create
   * @description Creates a new token on the blockchain
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Loaded STRATO dapp instance
   * @param {Object} req.body - Request body containing token creation parameters
   * @param {Object} req.body.itemArgs - Token parameters
   * @param {string} req.body.itemArgs.name - Token name
   * @param {string} req.body.itemArgs.description - Token description
   * @param {number} req.body.itemArgs.quantity - Token quantity to mint
   * @param {number} req.body.itemArgs.decimals - Token decimal places (0-18)
   * @param {Array<string>} req.body.itemArgs.images - Array of image URLs
   * @param {Array<string>} req.body.itemArgs.files - Array of file URLs
   * @param {Array<string>} req.body.itemArgs.fileNames - Array of file names
   * @param {string} req.body.itemArgs.redemptionService - Redemption service address
   * @param {string} req.body.itemArgs.paymentServiceCreator - Payment service creator address
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns operation result via Express response
   * @throws {rest.RestError} - Throws validation or server errors
   */
  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      TokensController.validateCreateTokensArgs(body);

      const result = await dapp.createTokens(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * @method addHash
   * @description Adds a transaction hash to a token record
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Loaded STRATO dapp instance
   * @param {Object} req.body - Request body containing hash details
   * @param {string} req.body.userAddress - User's blockchain address
   * @param {string} req.body.txHash - Transaction hash to add
   * @param {string} req.body.amount - Amount involved in the transaction
   * @param {string} req.body.tokenName - Name of the token
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns operation result via Express response
   * @throws {rest.RestError} - Throws validation or server errors
   */
  static async addHash(req, res, next) {
    try {
      const { dapp, body } = req;

      TokensController.validateAddHashArgs(body);

      const result = await dapp.addHash(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * @method bridgeOut
   * @description Bridges a token from the current chain to an external blockchain
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Loaded STRATO dapp instance
   * @param {Object} req.body - Request body containing bridge parameters
   * @param {string} req.body.quantity - Amount of tokens to bridge
   * @param {string} req.body.externalChainWalletAddress - Destination wallet address on external chain
   * @param {string} req.body.tokenAssetRootAddress - Root address of the token asset
   * @param {string} req.body.assetAddress - Address of the asset to bridge
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns operation result via Express response
   * @throws {rest.RestError} - Throws validation or server errors
   */
  static async bridgeOut(req, res, next) {
    try {
      const { dapp, body } = req;

      TokensController.validateBridgeOutArgs(body);

      const result = await dapp.bridgeOut(body);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * @method getBridgeableTokens
   * @description Retrieves a list of tokens that can be bridged to external chains
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Loaded STRATO dapp instance
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns array of bridgeable tokens via Express response
   * @throws {rest.RestError} - Throws server errors
   */
  static async getBridgeableTokens(req, res, next) {
    try {
      const { dapp } = req;
      const result = await dapp.getBridgeableAddresses({});
      const tokensArray =  await tokensJs.getBridgeableTokensAddress(result);
      return rest.response.status200(res, tokensArray);
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * @method validateCreateTokensArgs
   * @description Validates arguments for token creation
   * @param {Object} args - Arguments to validate
   * @param {Object} args.itemArgs - Token parameters 
   * @throws {rest.RestError} - Throws validation error if args are invalid
   */
  static validateCreateTokensArgs(args) {
    const createTokensSchema = Joi.object({
      itemArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        quantity: Joi.number().integer().min(1).required(),
        decimals: Joi.number().integer().min(0).max(18).required(),
        images: Joi.array().items(Joi.string()).required(),
        files: Joi.array().items(Joi.string()).required(),
        fileNames: Joi.array().items(Joi.string()).required(),
        redemptionService: Joi.string().required(),
        paymentServiceCreator: Joi.string().required(),
      }).required(),
    });

    const validation = createTokensSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Tokens Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  /**
   * @method validateAddHashArgs
   * @description Validates arguments for adding a transaction hash
   * @param {Object} args - Arguments to validate
   * @param {string} args.userAddress - User's blockchain address
   * @param {string} args.txHash - Transaction hash to add
   * @param {string} args.amount - Amount involved in the transaction
   * @param {string} args.tokenName - Name of the token
   * @throws {rest.RestError} - Throws validation error if args are invalid
   */
  static validateAddHashArgs(args) {
    const addHashSchema = Joi.object({
      userAddress: Joi.string().required(),
      txHash: Joi.string().required(),
      amount: Joi.string().required(),
      tokenName: Joi.string().required(),
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

  /**
   * @method validateBridgeOutArgs
   * @description Validates arguments for bridging tokens to external chains
   * @param {Object} args - Arguments to validate
   * @param {string} args.quantity - Amount of tokens to bridge
   * @param {string} args.externalChainWalletAddress - Destination wallet address on external chain
   * @param {string} args.tokenAssetRootAddress - Root address of the token asset
   * @param {string} args.assetAddress - Address of the asset to bridge
   * @throws {rest.RestError} - Throws validation error if args are invalid
   */
  static validateBridgeOutArgs(args) {
    const burnETHSTSchema = Joi.object({
      quantity: Joi.string().required(),
      externalChainWalletAddress: Joi.string().required(),
      tokenAssetRootAddress: Joi.string().required(),
      assetAddress: Joi.string().required(),
    });

    const validation = burnETHSTSchema.validate(args);

    if (validation.error) {
      console.log(validation.error.message);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Burn ETHST Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

}

export default TokensController;

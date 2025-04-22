/**
 * @fileoverview Redemption Controller
 * 
 * This module handles the business logic for redemption requests in the marketplace,
 * including creating redemption requests, retrieving redemption information,
 * and approving or rejecting redemption requests. It also handles email notifications
 * to both issuers and redeemers for various status changes.
 * 
 * The redemption process allows users to redeem their tokenized assets for physical
 * or digital goods and services. The process involves submitting a request, which then
 * requires approval from the issuer before the redemption can be completed.
 * 
 * @module api/v1/Redemption/RedemptionController
 * @see module:api/v1/Redemption
 */

import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import {
  RedemptionApprovalToIssuer,
  RedemptionApprovalToRedeemer,
  RedemptionRejectionToIssuer,
  RedemptionRejectionToRedeemer,
  RedemptionRequestToIssuer,
  RedemptionRequestToRedeemer,
} from '../../../helpers/emailTemplates';
import sendEmail from '../../../helpers/email';

/**
 * Controller class for handling redemption-related operations
 * 
 * @class RedemptionController
 */
class RedemptionController {
  /**
   * Retrieves a list of all available redemption services
   * 
   * Redemption services represent different methods or options available
   * for redeeming assets, such as physical pickup, digital delivery, etc.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of services to return
   * @param {number} [req.query.offset] - Number of services to skip for pagination
   * @param {boolean} [req.query.isActive] - Filter services by active status
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns list of redemption services or passes error to next middleware
   * @throws {RestError} - If there's an error retrieving the redemption services
   * @see GET /redemption/services
   */
  static async getRedemptionServices(req, res, next) {
    try {
      const { dapp, query } = req;
      const redemptionServices = await dapp.getRedemptionServices(query);
      rest.response.status200(res, redemptionServices);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves details of a specific redemption request by its unique ID
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.id - Unique identifier of the redemption request
   * @param {Object} req.query - Query parameters
   * @param {string} [req.query.redemptionService] - Optional redemption service filter
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns redemption details or passes error to next middleware
   * @throws {RestError} - If the redemption request doesn't exist or the user doesn't have permission
   * @see GET /redemption/{id}
   */
  static async get(req, res, next) {
    try {
      const { dapp, params, query } = req;
      const { id } = params;
      const { redemptionService } = query;

      let args = { id, redemptionService };

      const redemption = await dapp.getRedemption(args);
      rest.response.status200(res, redemption);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Creates a new redemption request for assets and sends email notifications
   * 
   * This method validates the request parameters, creates a new redemption request
   * in the blockchain, and sends email notifications to both the issuer and the
   * redeemer (owner) about the submission of the redemption request.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {Array<string>} [req.body.assetAddresses] - Array of blockchain addresses of assets to redeem
   * @param {string} req.body.assetName - Name of the asset being redeemed
   * @param {number} req.body.status - Status of the redemption (should be 1 for pending)
   * @param {number} req.body.quantity - Quantity of assets being redeemed
   * @param {number} req.body.decimals - Number of decimal places for the asset (0-18)
   * @param {number} req.body.shippingAddressId - ID of the shipping address for redemption
   * @param {string} req.body.ownerCommonName - Common name of the owner/redeemer
   * @param {string} req.body.issuerCommonName - Common name of the issuer
   * @param {string} [req.body.ownerComments] - Comments provided by the owner/redeemer
   * @param {string} [req.body.redemptionService] - Service used for the redemption
   * @param {string} [req.body.userAddress] - Blockchain address of the user requesting redemption
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns created redemption request or passes error to next middleware
   * @throws {RestError} - If validation fails or there's an error creating the redemption request
   * @see POST /redemption
   */
  static async requestRedemption(req, res, next) {
    try {
      const { dapp, body } = req;
      const {
        issuerCommonName,
        ownerCommonName,
        assetName,
        quantity,
        ownerComments,
      } = body;
      const { userAddress, ...restData } = body;
      RedemptionController.validateRequestRedemptionArgs(restData);

      const result = await dapp.requestRedemption(restData);
      rest.response.status200(res, result);

      const RedemptionRequestToIssuerTemplate = RedemptionRequestToIssuer(
        issuerCommonName,
        ownerCommonName,
        userAddress,
        assetName,
        quantity,
        ownerComments
      );
      const RedemptionRequestToRedeemerTemplate = RedemptionRequestToRedeemer(
        ownerCommonName,
        ownerCommonName,
        userAddress,
        assetName,
        quantity,
        ownerComments
      );
      await sendEmail(
        issuerCommonName,
        'Redemption Request Submitted for Review',
        RedemptionRequestToIssuerTemplate
      );
      await sendEmail(
        ownerCommonName,
        'Redemption Request Confirmation',
        RedemptionRequestToRedeemerTemplate
      );
      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves a list of redemption requests submitted by the authenticated user
   * 
   * This endpoint allows users to view all redemption requests they have submitted,
   * with optional filtering by status and pagination support.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of requests to return
   * @param {number} [req.query.offset] - Number of requests to skip
   * @param {number} [req.query.status] - Filter by redemption status (1=pending, 2=approved, 3=rejected)
   * @param {string} [req.query.redemptionService] - Filter by redemption service
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns list of outgoing redemption requests or passes error to next middleware
   * @throws {RestError} - If there's an error retrieving the redemption requests
   * @see GET /redemption/outgoing
   */
  static async getOutgoingRedemptionRequests(req, res, next) {
    try {
      const { dapp, query } = req;

      const redemptions = await dapp.getOutgoingRedemptionRequests(query);
      rest.response.status200(res, redemptions);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves a list of redemption requests submitted to the authenticated user as an issuer
   * 
   * This endpoint allows issuers to view redemption requests that require their review,
   * with optional filtering by status and pagination support.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of requests to return
   * @param {number} [req.query.offset] - Number of requests to skip
   * @param {number} [req.query.status] - Filter by redemption status (1=pending, 2=approved, 3=rejected)
   * @param {string} [req.query.redemptionService] - Filter by redemption service
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns list of incoming redemption requests or passes error to next middleware
   * @throws {RestError} - If there's an error retrieving the redemption requests
   * @see GET /redemption/incoming
   */
  static async getIncomingRedemptionRequests(req, res, next) {
    try {
      const { dapp, query } = req;

      const redemptions = await dapp.getIncomingRedemptionRequests(query);
      rest.response.status200(res, redemptions);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Approves or rejects a redemption request and sends email notifications
   * 
   * This method updates the status of a redemption request to either approved (2) or
   * rejected (3), adds issuer comments, and sends appropriate email notifications
   * to both the issuer and the redeemer about the decision.
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {number} req.body.id - Unique identifier for the redemption request to close
   * @param {number} req.body.status - New status of the redemption (2=approved, 3=rejected)
   * @param {string} req.body.issuerCommonName - Common name of the issuer
   * @param {Array<string>} [req.body.assetAddresses] - Array of blockchain addresses of assets
   * @param {string} [req.body.issuerComments] - Comments provided by the issuer
   * @param {string} [req.body.redemptionService] - Service used for the redemption
   * @param {string} [req.body.redeemerCommonName] - Common name of the redeemer
   * @param {string} [req.body.redeemerAddress] - Blockchain address of the redeemer
   * @param {string} [req.body.assetName] - Name of the asset being redeemed
   * @param {number} [req.body.quantity] - Quantity of assets being redeemed
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns updated redemption request or passes error to next middleware
   * @throws {RestError} - If validation fails or there's an error updating the redemption request
   * @see PUT /redemption/close
   */
  static async closeRedemption(req, res, next) {
    try {
      const { dapp, body } = req;
      const {
        redeemerCommonName,
        issuerCommonName,
        redeemerAddress,
        assetName,
        quantity,
        ...restData
      } = body;

      RedemptionController.validateCloseRedemptionArgs({
        issuerCommonName,
        ...restData,
      });

      const result = await dapp.closeRedemption({
        issuerCommonName,
        ...restData,
      });
      rest.response.status200(res, result);

      if (body.status === 2) {
        const RedemptionApprovalToIssuerTemplate = RedemptionApprovalToIssuer(
          issuerCommonName,
          redeemerCommonName,
          redeemerAddress,
          assetName,
          quantity,
          body.issuerComments
        );
        const RedemptionApprovalToRedeemerTemplate =
          RedemptionApprovalToRedeemer(
            redeemerCommonName,
            redeemerAddress,
            assetName,
            quantity,
            body.issuerComments
          );
        await sendEmail(
          issuerCommonName,
          'Redemption Request Approved',
          RedemptionApprovalToIssuerTemplate
        );
        await sendEmail(
          redeemerCommonName,
          'Redemption Request Approved',
          RedemptionApprovalToRedeemerTemplate
        );
      }
      if (body.status === 3) {
        const RedemptionRejectionToIssuerTemplate = RedemptionRejectionToIssuer(
          issuerCommonName,
          redeemerCommonName,
          redeemerAddress,
          assetName,
          quantity,
          body.issuerComments
        );
        const RedemptionRejectionToRedeemerTemplate =
          RedemptionRejectionToRedeemer(
            redeemerCommonName,
            redeemerAddress,
            assetName,
            quantity,
            body.issuerComments
          );
        await sendEmail(
          issuerCommonName,
          'Redemption Request Rejected',
          RedemptionRejectionToIssuerTemplate
        );
        await sendEmail(
          redeemerCommonName,
          'Redemption Request Rejected',
          RedemptionRejectionToRedeemerTemplate
        );
      }

      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * Validates redemption request arguments
   * 
   * Ensures that all required fields for creating a redemption request are present
   * and validates their formats using Joi schema validation.
   * 
   * @param {Object} args - Redemption request arguments to validate
   * @param {Array<string>} [args.assetAddresses] - Array of blockchain addresses of assets to redeem
   * @param {string} args.assetName - Name of the asset being redeemed
   * @param {number} args.status - Status of the redemption (must be 1 for pending)
   * @param {number} args.quantity - Quantity of assets being redeemed
   * @param {number} args.decimals - Number of decimal places for the asset (0-18)
   * @param {number} args.shippingAddressId - ID of the shipping address for redemption
   * @param {string} args.ownerCommonName - Common name of the owner/redeemer
   * @param {string} args.issuerCommonName - Common name of the issuer
   * @param {string} [args.ownerComments] - Comments provided by the owner/redeemer
   * @param {string} [args.redemptionService] - Service used for the redemption
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
  static validateRequestRedemptionArgs(args) {
    const requestRedemptionSchema = Joi.object({
      assetAddresses: Joi.array().items(Joi.string()),
      assetName: Joi.string().required(),
      status: Joi.number().integer().min(1).max(1).required(),
      quantity: Joi.number().integer().greater(0).required(),
      decimals: Joi.number().integer().min(0).max(18).required(),
      shippingAddressId: Joi.number().integer().required(),
      ownerCommonName: Joi.string().required(),
      issuerCommonName: Joi.string().required(),
      ownerComments: Joi.string().allow(''),
      redemptionService: Joi.string(),
    });

    const validation = requestRedemptionSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        validation.error.message,
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  /**
   * Validates close redemption arguments
   * 
   * Ensures that all required fields for closing a redemption request are present
   * and validates their formats using Joi schema validation. Closing a redemption
   * means either approving (status=2) or rejecting (status=3) the request.
   * 
   * @param {Object} args - Close redemption arguments to validate
   * @param {number} args.id - Unique identifier for the redemption request to close
   * @param {number} args.status - New status of the redemption (must be 2 or 3)
   * @param {string} args.issuerCommonName - Common name of the issuer
   * @param {Array<string>} [args.assetAddresses] - Array of blockchain addresses of assets
   * @param {string} [args.issuerComments] - Comments provided by the issuer
   * @param {string} [args.redemptionService] - Service used for the redemption
   * @throws {RestError} - If validation fails with HTTP 400 (Bad Request) status code
   * @private
   */
  static validateCloseRedemptionArgs(args) {
    const requestRedemptionSchema = Joi.object({
      id: Joi.number().integer().required(),
      assetAddresses: Joi.array().items(Joi.string()),
      status: Joi.number().integer().min(2).max(3).required(),
      issuerComments: Joi.string().allow(''),
      redemptionService: Joi.string(),
      issuerCommonName: Joi.string().required(),
    });

    const validation = requestRedemptionSchema.validate(args);

    if (validation.error) {
      console.log('validation error: ', validation.error);
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        validation.error.message,
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default RedemptionController;

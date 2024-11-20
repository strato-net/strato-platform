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

class RedemptionController {
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

  static validateRequestRedemptionArgs(args) {
    const requestRedemptionSchema = Joi.object({
      assetAddresses: Joi.array().items(Joi.string()),
      assetName: Joi.string().required(),
      status: Joi.number().integer().min(1).max(1).required(),
      quantity: Joi.number().integer().greater(0).required(),
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

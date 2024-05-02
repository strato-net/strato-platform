import client from '../db/index.js';
import config from '../load.config.js';
import Joi from '@hapi/joi';
import { rest, util } from "blockapps-rest";
import stripeService from './stripe.service.js';
import { ADMIN } from "../helpers/constants.js";
import { getStripeAccountForUser } from '../helpers/utils.js';

class StripeServiceController {

  // Onboard a user to Stripe
  static async stripeOnboarding(req, res, next) {
    try {
      // Validation
      StripeServiceController.validateStripeOnboardingArgs(req.headers.referer, req.body);

      const marketplaceUrl = req.headers.referer;
      const { commonName } = req.body;

      const userAccount = getStripeAccountForUser(commonName);

      if (!userAccount) {
        // Generate a new Stripe Account Id
        let userStripeAccount = await stripeService.generateStripeAccountId();

        // Insert new Stripe Account Id for user in DB
        const insertQuery = `
          INSERT INTO stripe_Accounts (
            commonName,
            accountId
          ) VALUES (
            $1, $2
          )`;
        const insertValues = [ commonName, userStripeAccount.id ];
        const insertResult = await client.query(insertQuery, insertValues);

        // Generate and return Stripe connect link 
        const connectLink = await stripeService.generateStripeAccountConnectLink(marketplaceUrl, userStripeAccount.id);
        res.status(200).json({
          connectLink: connectLink
        });
      } else {
        const connectLink = await stripeService.generateStripeAccountConnectLink(marketplaceUrl, userAccount);
        res.status(200).json({
          connectLink: connectLink
        });
      }
      return next();
    } catch (e) {
      next(e);
    }
  }

  static async stripeConnectStatus(req, res, next) {
    try {
      // Validation
      StripeServiceController.validateStripeStatusArgs(req.body);
      
      const { commonName } = req.body;

      const userAccount = getStripeAccountForUser(commonName);

      if (!userAccount) {
        throw new Error(`User not onboarded to Stripe yet.`);
      }

      // Get and return account connection status from Stripe
      const userStripeAccount = await stripeService.getStripeConnectAccountDetail(userAccount);
      res.status(200).json({
        chargesEnabled: userStripeAccount.charges_enabled,
        detailsSubmitted: userStripeAccount.details_submitted,
        payoutsEnabled: userStripeAccount.payouts_enabled,
      });
      return next();
    } catch (e) {
      next(e);
    }
  }

  static async stripeCheckout(req, res, next) {
    try {
      // Validation 
      StripeServiceController.validateStripeCheckoutArgs(req.headers.referer, req.body);

      const marketplaceUrl = req.headers.referer;
      const { paymentTypes, cartData, orderDetail, sellerCommonName } = req.body;

      const sellerAccount = getStripeAccountForUser(sellerCommonName);

      // Seller account verification
      if (!sellerAccount) {
        throw new Error(`Seller not onboarded to Stripe yet`);
      }

      // Seller account payment setup status verification
      const sellerStripeAccount = await stripeService.getStripeConnectAccountDetail(sellerAccount);
      if (sellerStripeAccount.charges_enabled !== true || 
          sellerStripeAccount.details_submitted !== true ||
          sellerStripeAccount.payouts_enabled !== true) {
        throw new Error(`Seller has not enabled payments on Stripe yet.`);
      }

      // Create and return checkout link
      const session = await stripeService.initiatePayment(marketplaceUrl, paymentTypes, cartData, orderDetail, sellerAccount);
      res.status(200).send(session);
      return next();
    } catch (e) {
      next(e);
    }
  }

  static async stripeCheckoutConfirm(req, res, next) {
    try {
      // Validation 
      StripeServiceController.validateStripeCheckoutConfirmArgs(req.body);

      const { paymentSessionId, sellerCommonName, paymentContractAddress, buyerAddress } = req.body;

      // Retrieve the session
      const sellerAccount = getStripeAccountForUser(sellerCommonName);
      const session = await stripeService.getPaymentSession(paymentSessionId, sellerAccount);

      // Verify payment and perform onchain transfer
      if (session.payment_status === 'paid') {
        const contract = { name: "CreditCard", address: paymentContractAddress };
        const options = { config };
        const callArgs = {
          contract,
          method: "transfer",
          args: util.usc({ to: buyerAddress }),
        };
        const transferStatus = await rest.call(ADMIN, callArgs, options);
        console.log("transferStatus", transferStatus);
        res.status(200);
      } else {
        throw new Error(`Payment has not been processed. Failed to confirm purchase.`);
      }
      return next();
    } catch (e) {
      next(e);
    }
  }

  // ********* VALIDATION ***********
  static validateStripeOnboardingArgs(referer, args) {
    const stripeOnboardingSchema = Joi.object({
      commonName: Joi.string().required(),
    })

    const validation = stripeOnboardingSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /onboard: ${validation.error.message}.`);
    }

    if (!referer) {
      throw new Error(`Missing MarketplaceURL as referer header in GET request /onboard.`);
    }
  }

  static validateStripeStatusArgs(args) {
    const stripeStatusSchema = Joi.object({
      commonName: Joi.string().required(),
    })

    const validation = stripeStatusSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /status: ${validation.error.message}.`);
    }
  }

  static validateStripeCheckoutArgs(referer, args) {
    const stripeCheckoutSchema = Joi.object({
      paymentTypes: Joi.array().min(1).items(Joi.string().required()).required(),
      cartData: Joi.object({
        buyerOrganization: Joi.string().required(),
        orderList: Joi.array().min(1).items(Joi.object({
              quantity: Joi.number().required(),
              assetAddress: Joi.string().required(),
              firstSale: Joi.boolean().required(),
              unitPrice: Joi.number().required()
            })).required(),
        orderTotal: Joi.number().required(),
        shippingAddressId: Joi.number().min(1).required(),
        tax: Joi.number().required(),
        user: Joi.string().required(),
        email: Joi.string().required(),
      }),
      orderDetail: Joi.array().items(
        Joi.object({
          productName: Joi.string().required(),
          unitPrice: Joi.number().min(1).required(),
          quantity: Joi.number().min(1).required(),
        })
      ),
      sellerCommonName: Joi.string().required(),
    });

    const validation = stripeCheckoutSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /checkout: ${validation.error.message}.`);
    }

    if (!referer) {
      throw new Error(`Missing MarketplaceURL as referer header in GET request /checkout.`);
    }
  }

  static validateStripeCheckoutConfirmArgs(args) {
    const stripeCheckoutConfirmSchema = Joi.object({
      paymentSessionId: Joi.string().required(),
      sellerCommonName: Joi.string().required(),
      paymentContractAddress: Joi.string().required(),
      buyerAddress: Joi.string().required(),
    })

    const validation = stripeCheckoutConfirmSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in POST request /checkout/confirm: ${validation.error.message}.`);
    }
  }

}

export default StripeServiceController;
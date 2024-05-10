import Joi from '@hapi/joi';
import stripeService from './stripe.service.js';
import { CLIENT_URL } from "../helpers/constants.js";
import { 
  getStripeAccountForUser, 
  getStripePaymentFromToken,
  insertStripeAccount,
  insertStripePayment,
  updateStripePayment,
  getPaymentState, 
  validateAndGetOrderDetails ,
  completeOrder,
  cancelOrder
} from '../helpers/utils.js';

class StripeServiceController {

  // Onboard a user to Stripe
  static async stripeOnboarding(req, res, next) {
    try {
      // Validation
      StripeServiceController.validateStripeOnboardingArgs(req.query);

      const { username, redirectUrl } = req.query;

      const userAccount = await getStripeAccountForUser(username);
      
      if (!userAccount) {
        // Generate a new Stripe Account Id
        let userStripeAccount = await stripeService.generateStripeAccountId();

        // Insert new Stripe Account Id for user in DB
        const insertResult = await insertStripeAccount(username, userStripeAccount.id);

        // Generate and return Stripe connect link 
        const connectLink = await stripeService.generateStripeAccountConnectLink(redirectUrl, username, userStripeAccount.id);
        res.setHeader('Content-Type', 'text/html');
        res.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta http-equiv="refresh" content="0;url=${connectLink.url}">
            </head>
            <body>
            </body>
          </html>
        `);
      } else {
        const connectLink = await stripeService.generateStripeAccountConnectLink(redirectUrl, username, userAccount);
        res.setHeader('Content-Type', 'text/html');
        res.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta http-equiv="refresh" content="0;url=${connectLink.url}">
            </head>
            <body>
            </body>
          </html>
        `);
      }
      return next();
    } catch (e) {
      next(e);
    }
  }

  static async stripeConnectStatus(req, res, next) {
    try {
      // Validation
      StripeServiceController.validateStripeStatusArgs(req.query);
      
      const { username } = req.query;

      const userAccount = await getStripeAccountForUser(username);

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
    // Validation try catch
    try {
       StripeServiceController.validateStripeCheckoutArgs(req.query);
     } catch (e) {
       next(e);
     }

    // Need function scope access for error case
    const { token, redirectUrl } = req.query;
    try {
      // Return a redirect to the payment server checkout page
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta http-equiv="refresh" content="0;url=${CLIENT_URL}/stripe/checkout?token=${token}&redirectUrl=${redirectUrl}">
          </head>
          <body>
          </body>
        </html>
      `);
      return next();
    } catch (e) {
      try {
        const cancelOrderStatus = await cancelOrder(token);
      }
      catch (err) {
        return next(err);
      }

      // Redirect back to marketplace
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta http-equiv="refresh" content="0;url=${redirectUrl}">
          </head>
          <body>
          </body>
        </html>
      `);
      next(e);
    }
  }

  static async initiateStripeCheckout(req, res, next) {
    // Validation try catch
    try {
      StripeServiceController.validateInitiateStripeCheckoutArgs(req.query);
    } catch (e) {
      next(e);
    }

    // Need function scope access for error case
    const { token, redirectUrl } = req.query;

    try {
      // Check if the payment session already exists for the token
      const paymentDetails = await getStripePaymentFromToken(token);

      // Skip all the extra work if the session already exists
      if (paymentDetails) {
        const session = await stripeService.getPaymentSession(paymentDetails.paymentsessionid, paymentDetails.accountid);
        // Return client secret
        res.status(200).send({ clientSecret: session.client_secret, accountId: paymentDetails.accountid });
        return next();
      }

      // Get the payment server contract
      const paymentState = await getPaymentState();

      // Get and validate the order details
      const order = paymentState.openOrders[token];
      const { sellerCommonName, orderDetails } = await validateAndGetOrderDetails(order.quantities, order.saleAddresses);

      const sellerAccount = await getStripeAccountForUser(sellerCommonName);

      // Seller account verification
      if (!sellerAccount) {
        throw new Error(`Seller not onboarded to Stripe yet.`);
      }

      // Seller account payment setup status verification
      const sellerStripeAccount = await stripeService.getStripeConnectAccountDetail(sellerAccount);
      if (sellerStripeAccount.charges_enabled !== true || 
          sellerStripeAccount.details_submitted !== true ||
          sellerStripeAccount.payouts_enabled !== true) {
        throw new Error(`Seller has not enabled payments on Stripe yet.`);
      }

      // Create checkout session and store in db
      const session = await stripeService.initiatePayment(redirectUrl, token, orderDetails, sellerAccount);
      const insertResult = await insertStripePayment(token, session.id, sellerCommonName);
      // Return client secret
      res.status(200).send({ clientSecret: session.client_secret, accountId: sellerAccount });
      return next();
    } catch (e) {
      try {
        const cancelOrderStatus = await cancelOrder(token);
      }
      catch (err) {
        return next(err);
      }

      // Redirect back to marketplace
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta http-equiv="refresh" content="0;url=${redirectUrl}">
          </head>
          <body>
          </body>
        </html>
      `);
      next(e);
    }
  }

  static async stripeCheckoutConfirm(req, res, next) {
    try {
      // Validation 
      StripeServiceController.validateStripeCheckoutConfirmArgs(req.query);

      const { token, redirectUrl } = req.query;

      // Retrieve the session
      const paymentDetails = await getStripePaymentFromToken(token);
      const session = await stripeService.getPaymentSession(paymentDetails.paymentsessionid, paymentDetails.accountid);
      // Verify payment and perform onchain transfer
      if (session.payment_status === 'paid') {
        const completeOrderStatus = await completeOrder(token);
        console.log("completeOrderStatus", completeOrderStatus);
        res.status(200);
      } else {
        throw new Error(`Payment has not been processed. Failed to confirm purchase.`);
      }

      // Update payment status in DB
      const updateResult = await updateStripePayment(token, "PAID");

      // Redirect back to marketplace
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta http-equiv="refresh" content="0;url=${redirectUrl}">
          </head>
          <body>
          </body>
        </html>
      `);
      return next();
    } catch (e) {
      next(e);
    }
  }

  static async stripeCheckoutCancel(req, res, next) {
    try {
      // Validation 
      StripeServiceController.validateStripeCheckoutCancelArgs(req.query);

      const { token, redirectUrl } = req.query;

      const cancelOrderStatus = await cancelOrder(token);
      console.log("cancelOrderStatus", cancelOrderStatus);
      res.status(200);

      const updateResult = await updateStripePayment(token, "CANCELED");

      // Redirect back to marketplace
      res.setHeader('Content-Type', 'text/html');
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta http-equiv="refresh" content="0;url=${redirectUrl}">
          </head>
          <body>
          </body>
        </html>
      `);
      return next();
    } catch (e) {
      next(e);
    }
  }

  // ********* VALIDATION ***********
  static validateStripeOnboardingArgs(args) {
    const stripeOnboardingSchema = Joi.object({
      username: Joi.string().required(),
      redirectUrl: Joi.string().required(),
    })

    const validation = stripeOnboardingSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /onboard: ${validation.error.message}.`);
    }
  }

  static validateStripeStatusArgs(args) {
    const stripeStatusSchema = Joi.object({
      username: Joi.string().required(),
    })

    const validation = stripeStatusSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /status: ${validation.error.message}.`);
    }
  }

  static validateStripeCheckoutArgs(args) {
    const stripeCheckoutSchema = Joi.object({
      token: Joi.string().required(),
      redirectUrl: Joi.string().required(),
    });

    const validation = stripeCheckoutSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /checkout: ${validation.error.message}.`);
    }
  }

  static validateInitiateStripeCheckoutArgs(args) {
    const initiateStripeCheckoutSchema = Joi.object({
      token: Joi.string().required(),
      redirectUrl: Joi.string().required(),
    });

    const validation = initiateStripeCheckoutSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /checkout/initiate: ${validation.error.message}.`);
    }
  }

  static validateStripeCheckoutConfirmArgs(args) {
    const stripeCheckoutConfirmSchema = Joi.object({
      token: Joi.string().required(),
      redirectUrl: Joi.string().required(),
    });

    const validation = stripeCheckoutConfirmSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in POST request /checkout/confirm: ${validation.error.message}.`);
    }
  }

  static validateStripeCheckoutCancelArgs(args) {
    const stripeCheckoutCancelSchema = Joi.object({
      token: Joi.string().required(),
      redirectUrl: Joi.string().required(),
    });

    const validation = stripeCheckoutCancelSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /checkout/cancel: ${validation.error.message}.`);
    }
  }
}

export default StripeServiceController;
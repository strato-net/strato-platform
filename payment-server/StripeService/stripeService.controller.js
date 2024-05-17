import Joi from '@hapi/joi';
import stripeService from './stripe.service.js';
import { 
  getStripeAccountForUser, 
  getStripePaymentFromToken,
  getStripePaymentsFromTokens,
  insertStripeAccount,
  insertStripePayment,
  updateStripePayment,
  emitOnboardSeller,
  getPaymentEvent, 
  validateAndGetOrderDetails ,
  completeOrder,
  initializePayment,
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
        res.redirect(`${connectLink.url}`);
      } else {
        const connectLink = await stripeService.generateStripeAccountConnectLink(redirectUrl, username, userAccount);
        res.redirect(`${connectLink.url}`);
      }
      return next();
    } catch(e) {
      next(e);
    }
  }

  static async stripeOnboardingConfirm(req, res, next) {
    try {
      // Validation
      StripeServiceController.validateStripeOnboardingConfirmArgs(req.query);

      const { username, redirectUrl } = req.query;

      // Call onboardSeller
      const callArgs = {
        username: username,
        isActive: true,
      }
      const onboardSellerStatus = await emitOnboardSeller(callArgs);
      console.log("onboardSellerStatus", onboardSellerStatus);

      // Redirect back to marketplace
      res.redirect(`${redirectUrl}`);
      return next();
    } catch(e) {
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
    } catch(e) {
      next(e);
    }
  }

  static async stripeCheckout(req, res, next) {
    try {
      // Validation try catch
      StripeServiceController.validateStripeCheckoutArgs(req.query);

      const { token, redirectUrl } = req.query;

      // Check if the payment session already exists for the token
      const paymentDetails = await getStripePaymentFromToken(token);

      // Skip all the extra work if the session already exists
      if (paymentDetails && paymentDetails.status === "OPEN") {
        const session = await stripeService.getPaymentSession(paymentDetails.paymentsessionid, paymentDetails.accountid);
        
        // Redirect to Stripe payment session
        res.redirect(`${session.url}`);
        return next();
      }

      // Get the payment event from Cirrus
      const paymentEvent = await getPaymentEvent(token);

      // Get and validate the order details
      const saleAddresses = paymentEvent[0].saleAddresses;
      const quantities = paymentEvent[0].quantities;
      const { sellerCommonName, orderDetails } = await validateAndGetOrderDetails(quantities, saleAddresses);

      // Seller account verification
      const sellerAccount = await getStripeAccountForUser(sellerCommonName);
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

      // Create checkout session and store in DB
      const session = await stripeService.initiatePayment(redirectUrl, token, orderDetails, sellerAccount);
      const insertResult = await insertStripePayment(token, session.id, sellerCommonName);

      // Redirect to Stripe payment session
      res.redirect(`${session.url}`);
      return next();
    } catch(e) {
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
      let returnStatus;
      if (session.payment_status === 'paid') {
        // Get the payment event from Cirrus
        const paymentEvent = await getPaymentEvent(token);

        // Call completeOrder
        const callArgs = {
          token: paymentEvent[0].token,
          orderId: paymentEvent[0].orderId,
          purchaser: paymentEvent[0].purchaser,
          saleAddresses: paymentEvent[0].saleAddresses,
          quantities: paymentEvent[0].quantities,
        } 
        returnStatus = await completeOrder(callArgs);

        // Update payment status in DB
        const updateResult = await updateStripePayment(token, "PAID");
      } else if (session.payment_status === 'unpaid' && session.status === 'complete') {
        // ACH payment
        // Get the payment event from Cirrus
        const paymentEvent = await getPaymentEvent(token);

        // Call initializePayment
        const callArgs = {
          token: paymentEvent[0].token,
          orderId: paymentEvent[0].orderId,
          purchaser: paymentEvent[0].purchaser,
          saleAddresses: paymentEvent[0].saleAddresses,
          quantities: paymentEvent[0].quantities,
        } 
        returnStatus = await initializePayment(callArgs);

        // Update payment status in DB
        const updateResult = await updateStripePayment(token, "INITIALIZED");
      } else {
        throw new Error(`Payment has not been processed. Failed to confirm purchase. Please contact an Admin or the Payment Server Admin.`);
      }

      console.log("returnStatus", returnStatus);

      // Redirect back to marketplace
      res.redirect(`${redirectUrl}?assets=${returnStatus}`);
      return next();
    } catch(e) {
      next(e);
    }
  }

  static async stripeCheckoutCancel(req, res, next) {
    try {
      // Validation 
      StripeServiceController.validateStripeCheckoutCancelArgs(req.query);

      const { token, redirectUrl } = req.query;

      // Get the payment event from Cirrus
      const paymentEvent = await getPaymentEvent(token);

      // Construct completeOrder args
      const callArgs = {
        token: paymentEvent[0].token,
        orderId: paymentEvent[0].orderId,
        purchaser: paymentEvent[0].purchaser,
        saleAddresses: paymentEvent[0].saleAddresses,
        quantities: paymentEvent[0].quantities,
      } 

      const cancelOrderStatus = await cancelOrder(callArgs);
      console.log("cancelOrderStatus", cancelOrderStatus);

      // Update payment status in DB
      const updateResult = await updateStripePayment(token, "CANCELED");

      // Redirect back to marketplace
      res.redirect(`${redirectUrl}`);
      return next();
    } catch(e) {
      next(e);
    }
  }

  static async stripeOrderStatus(req, res, next) {
    try {
      // Validation
      StripeServiceController.validateStripeOrderStatusArgs(req.query);
      
      const { tokens } = req.query;

      // Get all statuses from tokens and recheck status from Stripe if ACH initialized
      const paymentDetails = await getStripePaymentsFromTokens(tokens);
      const statuses = paymentDetails.map(async (p) => {
        if (p.status === 'INITIALIZED') {
          const session = await stripeService.getPaymentSession(p.paymentsessionid, p.accountid);
          if (session.payment_status === 'paid') {
            // Update payment status in DB
            const updateResult = await updateStripePayment(p.token, 'PAID');
            return 'PAID';
          }
        }
        return p.status;
      });

      res.status(200).send(statuses);
      return next();
    } catch(e) {
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

  static validateStripeOnboardingConfirmArgs(args) {
    const stripeOnboardingConfirmSchema = Joi.object({
      username: Joi.string().required(),
      redirectUrl: Joi.string().required(),
    })

    const validation = stripeOnboardingConfirmSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /onboard/confirm: ${validation.error.message}.`);
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

  static validateStripeOrderStatusArgs(args) {
    const stripeOrderStatusSchema = Joi.object({
      tokens: Joi.array().items(Joi.string().required()).required(),
    });

    const validation = stripeOrderStatusSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /order/status: ${validation.error.message}.`);
    }
  }
}

export default StripeServiceController;
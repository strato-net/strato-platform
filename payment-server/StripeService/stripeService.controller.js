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
  getCheckoutEvent, 
  checkSellerOnboarded,
  validateAndGetOrderDetails ,
  completeOrder,
  generateIntermediateOrder,
  cancelOrder,
  discardCheckoutQuantity,
  getAsset,
  prepareOrderData,
  sendEmail,
} from '../helpers/utils.js';
import { buildConcatenatedOrderString } from '../helpers/emailTemplate.js';
import { PAYMENT_STATUS, STRIPE_CONTRACT_ADDRESS, PAYMENT_RECEIVED_MESSAGE } from '../helpers/constants.js';

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

      const userAccount = await getStripeAccountForUser(username);
      
      if (!userAccount) {
        throw new Error(`User has not onboarded to this payment server yet.`);
      }

      const hasSellerOnboarded = await checkSellerOnboarded(username);

      if (!hasSellerOnboarded || hasSellerOnboarded.length === 0 || hasSellerOnboarded[0].isActive === false) {
        const userDetails = await stripeService.getStripeConnectAccountDetail(userAccount);

        if (userDetails.charges_enabled && userDetails.details_submitted && userDetails.payouts_enabled) {
          // Call onboardSeller
          const callArgs = {
            sellersCommonName: username,
            isActive: true,
          }
          const onboardSellerStatus = await emitOnboardSeller(STRIPE_CONTRACT_ADDRESS, callArgs);
          console.log("onboardSellerStatus", onboardSellerStatus);
        }
      }

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
        throw new Error(`User has not onboarded to this payment server yet.`);
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
      // Validation
      StripeServiceController.validateStripeCheckoutArgs(req.query);
      const { checkoutHash, redirectUrl } = req.query;

      // Check if the payment session already exists for the token
      const paymentDetails = await getStripePaymentFromToken(checkoutHash);

      // Skip all the extra work if the session already exists
      if (paymentDetails && paymentDetails.status === "OPEN") {
        const session = await stripeService.getPaymentSession(paymentDetails.paymentsessionid, paymentDetails.accountid);
        
        // Redirect to Stripe payment session
        res.redirect(`${session.url}`);
        return next();
      }

      // Get the payment event from Cirrus
      const checkoutEvent = await getCheckoutEvent(checkoutHash);

      if (!checkoutEvent) {
        throw new Error(`Cannot find checkout event with hash ${checkoutHash}.`);
      }

      // Get and validate the order details
      const saleAddresses = checkoutEvent[0].saleAddresses;
      const quantities = checkoutEvent[0].quantitiesToBePurchased;
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
      const session = await stripeService.initiatePayment(redirectUrl, checkoutHash, orderDetails, sellerAccount);
      const insertResult = await insertStripePayment(checkoutHash, session.id, sellerCommonName);

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
      const { checkoutHash, redirectUrl } = req.query;

      // Retrieve the session
      const paymentDetails = await getStripePaymentFromToken(checkoutHash);
      const session = await stripeService.getPaymentSession(paymentDetails.paymentsessionid, paymentDetails.accountid);

      // Redirect back to marketplace
      res.redirect(`${redirectUrl}?assets=[]&orderHash=${checkoutHash}`);

      // Verify payment and perform onchain transfer
      let returnStatus;
      if (session.payment_status === 'paid') {
        // Get the payment event from Cirrus
        const checkoutEvent = await getCheckoutEvent(checkoutHash);

        // Call completeOrder
        const callArgs = {
          orderHash: checkoutEvent[0].checkoutHash,
          orderId: checkoutEvent[0].checkoutId,
          purchaser: checkoutEvent[0].purchaser,
          saleAddresses: checkoutEvent[0].saleAddresses,
          quantities: checkoutEvent[0].quantitiesToBePurchased,
          currency: 'USD',
          createdDate:  Math.floor(Date.now() / 1000),
          comments: PAYMENT_RECEIVED_MESSAGE,
        } 
        returnStatus = await completeOrder(STRIPE_CONTRACT_ADDRESS, callArgs);

        // Update payment status in DB
        const updateResult = await updateStripePayment(checkoutHash, "PAID");

        // EMAIL CONFIRMATION
        // Prepare HTML content and sendEmail
        try {
          const assetData = await getAsset(checkoutEvent[0].saleAddresses[0]);
          const orderString = prepareOrderData(checkoutEvent, assetData);
          const htmlContents = buildConcatenatedOrderString(checkoutEvent[0].purchasersCommonName, orderString, assetData);
      
          await sendEmail(checkoutEvent[0].purchasersCommonName, "Your Order Confirmation", htmlContents);
          console.log("*Buyer placed order*");
        } catch (emailError) {
          console.error("Error sending email confirmation for credit card:", emailError);
        }

        

      } else if (session.payment_status === 'unpaid' && session.status === 'complete') {
        // ACH payment
        // Get the payment event from Cirrus
        const checkoutEvent = await getCheckoutEvent(checkoutHash);

        // Call generateIntermediateOrder
        const callArgs = {
          checkoutHash: checkoutEvent[0].checkoutHash,
          checkoutId: checkoutEvent[0].checkoutId,
          purchaser: checkoutEvent[0].purchaser,
          saleAddresses: checkoutEvent[0].saleAddresses,
          quantities: checkoutEvent[0].quantitiesToBePurchased,
          currency: 'USD',
          createdDate:  Math.floor(Date.now() / 1000),
          comments: "",
        } 
        returnStatus = await generateIntermediateOrder(STRIPE_CONTRACT_ADDRESS, callArgs);

        // Update payment status in DB
        const updateResult = await updateStripePayment(checkoutHash, "INITIALIZED");
        
        // EMAIL CONFIRMATION
        // Prepare HTML content and sendEmail
        try {
          const assetData = await getAsset(checkoutEvent[0].saleAddresses[0]);
          const orderString = prepareOrderData(checkoutEvent, assetData);
          const htmlContents = buildConcatenatedOrderString(checkoutEvent[0].purchasersCommonName, orderString, assetData);
      
          await sendEmail(checkoutEvent[0].purchasersCommonName, "Your Order Confirmation", htmlContents);
          console.log("*Buyer placed order*");
        } catch (emailError) {
          console.error("Error sending email confirmation for ACH:", emailError);
        }


      } else {
        throw new Error(`Payment has not been processed. Failed to confirm purchase. Please contact an Admin or the Payment Server Admin.`);
      }

      console.log("returnStatus", returnStatus);

      return next();
    } catch(e) {
      next(e);
    }
  }

  static async stripeCheckoutCancel(req, res, next) {
    try {
      // Validation
      StripeServiceController.validateStripeCheckoutCancelArgs(req.query);
      const { checkoutHash, redirectUrl } = req.query;

      // Get the payment event from Cirrus
      const checkoutEvent = await getCheckoutEvent(checkoutHash);

      // Construct cancelOrder args to discard the order
      const callArgs = {
        checkoutHash: checkoutEvent[0].checkoutHash,
        checkoutId: checkoutEvent[0].checkoutId,
        purchaser: checkoutEvent[0].purchaser,
        saleAddresses: checkoutEvent[0].saleAddresses,
        quantities: checkoutEvent[0].quantitiesToBePurchased,
      } 

      const cancelOrderStatus = await discardCheckoutQuantity(STRIPE_CONTRACT_ADDRESS, callArgs);
      console.log("cancelOrderStatus", cancelOrderStatus);

      // Update payment status in DB
      const updateResult = await updateStripePayment(checkoutHash, "DISCARDED");

      // Redirect back to marketplace
      res.redirect(`${redirectUrl}`);
      return next();
    } catch(e) {
      next(e);
    }
  }

  static async stripeOrderStatus(req, res, next) {
    try {
      
      const { orderHashes } = req.query;

      // Get all statuses from tokens and recheck status from Stripe if ACH initialized
      let statuses = {};
      const paymentDetails = await getStripePaymentsFromTokens(JSON.parse(orderHashes));
      paymentDetails.map(async (p) => {
        if (p.status === 'INITIALIZED') {
          const session = await stripeService.getPaymentSession(p.paymentsessionid, p.accountid);
          if (session.payment_status === 'paid') {
            // Get the payment event from Cirrus
            const checkoutEvent = await getCheckoutEvent(p.orderhash);

            // Call completeOrder
            const callArgs = {
              orderHash: checkoutEvent[0].checkoutHash,
              orderId: checkoutEvent[0].checkoutId,
              purchaser: checkoutEvent[0].purchaser,
              saleAddresses: checkoutEvent[0].saleAddresses,
              quantities: checkoutEvent[0].quantitiesToBePurchased,
              currency: 'USD',
              createdDate: Math.floor(Date.now() / 1000),
              comments: PAYMENT_RECEIVED_MESSAGE,
            } 
            try {
              const returnStatus = await completeOrder(STRIPE_CONTRACT_ADDRESS, callArgs);
            } catch (err) {
              // this is left empty without any logging because it will flood the payment server with useless
              // error logs
            }

            // Update payment status in DB
            try {
              const updateResult = await updateStripePayment(p.orderhash, 'PAID');
            } catch (err) {
              // this is left empty without any logging because it will flood the payment server with useless
              // error logs
            }
            statuses[p.orderhash] = PAYMENT_STATUS['PAID'];
          }
          else{
          /////////////////////////////////// ACH Cancellation Flow ////////////////////////////////////////////////////////////////  
          
          const intent = await stripeService.getPaymentIntent(session.payment_intent, p.accountid);
          const ERROR_MESSAGE = intent?.last_payment_error?.message;
          const paymentErrorAndRequiresPaymentMethod = ERROR_MESSAGE && intent.status === 'requires_payment_method';


          if(paymentErrorAndRequiresPaymentMethod)
            {
              const checkoutEvent = await getCheckoutEvent(p.orderhash);
              
              const callArgs = {
                orderHash: checkoutEvent[0].checkoutHash,
                orderId: checkoutEvent[0].checkoutId,
                purchaser: checkoutEvent[0].purchaser,
                saleAddresses: checkoutEvent[0].saleAddresses,
                quantities: checkoutEvent[0].quantitiesToBePurchased,
                currency: 'USD',
                createdDate: Math.floor(Date.now() / 1000),
                comments: ERROR_MESSAGE,
              } 
        
              try {
                const cancelOrderStatus = await cancelOrder(STRIPE_CONTRACT_ADDRESS, callArgs);
                console.log("cancelOrderStatus", cancelOrderStatus);
              } catch (err) {
                // this is left empty without any logging because it will flood the payment server with useless
                // error logs
              }
        
              // Update payment status in DB
              const updateResult = await updateStripePayment(p.orderHash, "CANCELED");
            }
          }
        }
        statuses[p.orderhash] = PAYMENT_STATUS[p.status];
      });

      res.status(200).json(statuses);
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
      checkoutHash: Joi.string().required(),
      redirectUrl: Joi.string().required(),
    });

    const validation = stripeCheckoutSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /checkout: ${validation.error.message}.`);
    }
  }

  static validateStripeCheckoutConfirmArgs(args) {
    const stripeCheckoutConfirmSchema = Joi.object({
      checkoutHash: Joi.string().required(),
      redirectUrl: Joi.string().required(),
    });

    const validation = stripeCheckoutConfirmSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in POST request /checkout/confirm: ${validation.error.message}.`);
    }
  }

  static validateStripeCheckoutCancelArgs(args) {
    const stripeCheckoutCancelSchema = Joi.object({
      checkoutHash: Joi.string().required(),
      redirectUrl: Joi.string().required(),
    });

    const validation = stripeCheckoutCancelSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /checkout/cancel: ${validation.error.message}.`);
    }
  }

  static validateStripeOrderStatusArgs(args) {
    const stripeOrderStatusSchema = Joi.object({
      orderHashes: Joi.array().items(Joi.string().required()).required(),
    });

    const validation = stripeOrderStatusSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /order/status: ${validation.error.message}.`);
    }
  }
}

export default StripeServiceController;
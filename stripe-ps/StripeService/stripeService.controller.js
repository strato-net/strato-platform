const dayjs = require('dayjs');
const Joi = require('@hapi/joi');
const stripeService = require('./stripe.service');

class StripeServiceController {

  static async stripeOnboarding(req, res, next) {
    try {
      const accountId = req.params.accountId;

      if (!accountId) {
        let userStripeAccount = await stripeService.generateStripeAccountId();
        const accountDetails = {
          name: 'STRIPE',
          accountId: userStripeAccount.id, status: "", createdDate: dayjs().unix(),
        };
        userStripeAccount = userStripeAccount.id;
        const connectLink = await stripeService.generateStripeAccountConnectLink(userStripeAccount);
        res.status(200).json({
          connectLink: connectLink, 
          accountDetails: accountDetails,
        });
      }
      else {
        const connectLink = await stripeService.generateStripeAccountConnectLink(accountId);
        res.status(200).json({
          connectLink: connectLink,
        });
      }
      return next();
    } catch (e) {
      next(e);
    }
  }

  static async stripeConnectStatus(req, res, next) {
    try {
      if (!req.params.accountId) {
        throw new Error('Missing account ID in GET request /status/:accountId');
      }
      
      const accountId = req.params.accountId;

      const userStripeAccount = await stripeService.getStripeConnectAccountDetail(accountId);
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

  static async stripeGetSession(req, res, next) {
    try {
      StripeServiceController.validateStripeGetSessionArgs(req.params);

      const { sessionId, sellerAccountId } = req.params;
      
      const session = await stripeService.getPaymentSession(sessionId, sellerAccountId);
      res.status(200).json({ ...session });
      return next();
    } catch (e) {
      next(e);
    }
  }

  static async stripeCheckout(req, res, next) {
    try {
      StripeServiceController.validateStripeCheckoutArgs(req.body);

      const { cartData, orderDetail, accountId } = req.body;

      const session = await stripeService.initiatePayment(cartData, orderDetail, accountId);
      res.status(200).send(session);
      return next();
    } catch (e) {
      next(e);
    }
  }

  static async stripeWebhook(req, res, next) {
    try {
      const event = req.body;

      switch(event.type) {
        case 'account.application.deauthorized':
          break;
        case 'account.updated':
          break;
        case 'account.external_account.deleted':
          break;
        case 'account.external_account.updated':
          break;
        default:
          console.log(`Unhandled event type ${event.type}`);
      }
      res.status(200).json({
        received: true,
      });
      return next();
    } catch (e) {
      next(e);
    }
  }

  static async stripeWebhookConnect(req, res, next) {
    try {
      res.status(200).send('TODO');
      return next();
    } catch (e) {
      next(e);
    }
  }

  // ********* VALIDATION ***********
  static validateStripeCheckoutArgs(args) {
    const stripeCheckoutSchema = Joi.object({
      cartData: Joi.object({
        buyerOrganization: Joi.string().required(),
        orderList: Joi.array().min(1).items(Joi.object({
              quantity: Joi.number().required(),
              assetAddress: Joi.string().required(),
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
      accountId: Joi.string().required(),
    });

    const validation = stripeCheckoutSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /checkout: ${validation.error.message}`);
    }
  }

  static validateStripeGetSessionArgs(args) {
    const stripeGetSessionSchema = Joi.object({
      sessionId: Joi.string().required(),
      sellerAccountId: Joi.string().required(),
    })

    const validation = stripeGetSessionSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in GET request /session: ${validation.error.message}`);
    }
  }

}

module.exports = StripeServiceController;
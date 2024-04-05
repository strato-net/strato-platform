import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'

class PaymentServiceController {

  static async metaMaskOnboarding(req, res, next) {
    try {
      const { params, dapp } = req;
      // TODO: call payment server
      const result = await dapp.metaMaskOnboarding(params)

      rest.response.status200(res, result)

      return next();
    } catch (e) {
      return next(e)
    }
  }

  static async metaMaskOnboardingStatus(req, res, next) {
    try {
      const { dapp, params } = req

      PaymentServiceController.validateGetStripeOnboardingStatusArgs(params)
      // TODO: call payment server
      const result = await dapp.getMetaMaskOnboardingStatus(params)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async stripeOnboarding(req, res, next) {
    try {
      const { dapp } = req

      const result = await dapp.stripeOnboarding()
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async stripeOnboardingStatus(req, res, next) {
    try {
      const { dapp, params } = req

      PaymentServiceController.validateGetStripeOnboardingStatusArgs(params)

      const result = await dapp.getStripeOnboardingStatus(params)
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  // TODO implement stripe webhook
  static async stripeWebhook(req, res, next) {
    try {
      const { body: { type, data: { object } }, dapp } = req
      console.log("-----------------stripeWebhookStart----------------------------");
      console.log({ type, object });
      console.log("-----------------stripeWebhookEnd----------------------------");

      // Handle the event
      switch (type) {
        case 'checkout.session.async_payment_failed':
          const checkoutSessionAsyncPaymentFailed = object;
          // Then define and call a function to handle the event checkout.session.async_payment_failed
          break;
        case 'checkout.session.async_payment_succeeded':
          const checkoutSessionAsyncPaymentSucceeded = object;
          // Then define and call a function to handle the event checkout.session.async_payment_succeeded
          break;
        case 'checkout.session.completed':
          // Then define and call a function to handle the event checkout.session.completed
          const paymentSessionId = object.id;
          const paymentStatus = object.payment_status;
          const sessionStatus = object.status;
          const paymentIntentId = object.payment_intent;
          await dapp.updatePayment({ paymentSessionId, paymentStatus, paymentIntentId, sessionStatus })
          break;
        case 'checkout.session.expired':
          const checkoutSessionExpired = object;
          // Then define and call a function to handle the event checkout.session.expired
          break;
        // ... handle other event types
        default:
          console.log(`Unhandled event type ${type}`);
      }
      rest.response.status200(res)
    } catch (e) {
      return next(e)
    }
  }

  // TODO implement stripe webhook
  static async stripeWebhookConnect(req, res, next) {
    try {
      const { body: { type, data, created, account }, dapp } = req
      console.log("-----------------stripeWebhookConnectStart----------------------------");
      console.log({ type, data, created });
      console.log("-----------------stripeWebhookConnectEnd----------------------------");
      // Handle the event
      switch (type) {
        case 'account.updated':
          const { charges_enabled, details_submitted, payouts_enabled } = data.object;
          await dapp.updateStripeOnboardingStatus({ accountId: account, chargesEnabled: charges_enabled, detailsSubmitted: details_submitted, payoutsEnabled: payouts_enabled, accountDeauthorized: false, eventTime: created })
          // Then define and call a function to handle the event account.updated
          break;
        case 'account.application.authorized':
          const accountApplicationAuthorized = data.object;
          // Then define and call a function to handle the event account.application.authorized
          break;
        case 'account.application.deauthorized':
          // Then define and call a function to handle the event account.application.deauthorized
          await dapp.updateStripeOnboardingStatus({ accountId: account, chargesEnabled: false, detailsSubmitted: false, payoutsEnabled: false, eventTime: created, accountDeauthorized: true })
          break;
        case 'account.external_account.deleted':
          const accountExternalAccountDeleted = data.object;
          // Then define and call a function to handle the event account.external_account.deleted
          break;
        case 'account.external_account.updated':
          const accountExternalAccountUpdated = data.object;
          // Then define and call a function to handle the event account.external_account.updated
          break;
        // ... handle other event types
        default:
          console.log(`Unhandled event type ${type}`);
      }
      rest.response.status200(res)
    } catch (e) {
      return next(e)
    }
  }

  static validateGetStripeOnboardingStatusArgs(args) {
    const getStripeOnboardingStatusSchema = Joi.object({
      ownerCommonName: Joi.string().invalid(":ownerCommonName").required(),
    });

    const validation = getStripeOnboardingStatusSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Get stripeOnboarding status Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }
}


export default PaymentServiceController
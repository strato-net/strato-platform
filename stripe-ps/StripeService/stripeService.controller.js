const dayjs = require('dayjs');
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

  static async stripeWebhook(req, res, next) {
    try {
      res.status(200).send('TODO');
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

}

module.exports = StripeServiceController;
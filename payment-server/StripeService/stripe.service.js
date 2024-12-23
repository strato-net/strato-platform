import { STRIPE_ENV, SERVER_CONFIRM_URL, SERVER_CANCEL_URL, SERVER_URL } from '../helpers/constants.js';
import Stripe from 'stripe';
const stripe = Stripe(STRIPE_ENV.CREDENTIALS.STRIPE_SECRET_KEY);

class StripeService {
    // TODO implement orderDetail to create actual order line items 
    static initiatePayment(marketplaceUrl, checkoutHash, orderDetails, CONNECTED_ACCOUNT_ID = '') {
        try {
            // Create a checkout session with Stripe
            return stripe.checkout.sessions.create({
                payment_method_types: [ 'card', 'us_bank_account' ],
                payment_method_options: {
                    us_bank_account: {
                      verification_method: 'instant',
                  },
                },
                line_items: orderDetails.map(({ productName, unitPrice, quantity }) => {
                    return {
                        price_data: {
                            currency: "usd",
                            product_data: {
                                name: productName,
                            },
                            unit_amount: (unitPrice * 100).toFixed(0),
                        },
                        quantity: quantity,
                    }
                }),
                metadata: {},
                payment_intent_data: {
                    // Calculation of Application Fee
                    application_fee_amount: this.calculateApplicationFee(orderDetails),
                    /* To be used in case of destination charge */
                    // transfer_data: {
                    //     destination: CONNECTED_ACCOUNT_ID
                    // },
                },
                mode: "payment",
                success_url: `${SERVER_CONFIRM_URL}?checkoutHash=${checkoutHash}&redirectUrl=${marketplaceUrl}`,
                cancel_url: `${SERVER_CANCEL_URL}?checkoutHash=${checkoutHash}&redirectUrl=${marketplaceUrl}`,
            }, {
                stripeAccount: CONNECTED_ACCOUNT_ID
            })

        } catch (e) {
            throw new Error(`Stripe error: ${e.message}`)
        }
    }

    static calculateApplicationFee(orderDetailsList) {
        try {
        /* Based on the Type of Sale, this helper method is used to calculate application fee using the unit price and the item quantity */
            return orderDetailsList.map(order => {
                    const applicationFeePercentage = order.firstSale ? 10 : 3;
                    return Math.round(applicationFeePercentage * order.unitPrice * order.quantity);
                    }).reduce((acc, currentValue) => acc + currentValue, 0);
        } catch (e) {
            throw new Error(`Stripe Application Fee (Tx Fee) Calculation error: ${e.message}`)
        }
    }

    static getPaymentSession(session_id, CONNECTED_ACCOUNT_ID) {
        try {
            return stripe.checkout.sessions.retrieve(session_id, {
                stripeAccount: CONNECTED_ACCOUNT_ID
            });
        } catch (e) {
            throw new Error(`Stripe error: ${e.message}`)
        }
    }

    static async getPaymentIntent(paymentIntentId, CONNECTED_ACCOUNT_ID) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
            stripeAccount: CONNECTED_ACCOUNT_ID
          });
          return paymentIntent;
        } catch (error) {
          throw new Error(`Stripe error: ${error.message}`);
        }
      }

    static generateStripeAccountId(type = 'standard') {
        try {
            return stripe.accounts.create({ type });
        } catch (error) {
            throw new Error(`Stripe error: ${error.message}`);
        }
    }

    static generateStripeAccountConnectLink(marketplaceUrl, username, stripeAccountId) {
        try {
            return stripe.accountLinks.create({
                account: stripeAccountId,
                refresh_url: `${SERVER_URL}/stripe/onboard?username=${username}&redirectUrl=${marketplaceUrl}`,
                return_url: `${SERVER_URL}/stripe/onboard/confirm?username=${username}&redirectUrl=${marketplaceUrl}`,
                type: 'account_onboarding',
            });
        } catch (e) {
            throw new Error(`Stripe error: ${e.message}`);
        }
    }

    static getStripeConnectAccountDetail(accountId) {
        try {
            return stripe.accounts.retrieve(accountId);
        } catch (e) {
            throw new Error(`Stripe error: ${e.message}`);
        }
    }
}

export default StripeService;
import { rest } from "blockapps-rest";
import { STRIPE_ENV } from '/helpers/constants'
const Stripe = require('stripe');
const stripe = Stripe(STRIPE_ENV.CREDENTIALS.STRIPE_SECRET_KEY);

class StripeService {
    // TODO implement orderDetail to create actual order line items 
    static initiatePayment(cartData, orderDetail, CONNECTED_ACCOUNT_ID = '') {
        try {
            // Create a checkout session with Stripe
            return stripe.checkout.sessions.create({
                payment_method_types: STRIPE_ENV.CHECKOUT.PAYMENT_METHOD_TYPES,
                // For each item use the id to get it's information
                // Take that information and convert it to Stripe's format
                // shipping_address_collection: { allowed_countries: ['US'] },
                // billing_address_collection: "required",
                line_items: orderDetail.map(({ productName, unitPrice, quantity }) => {
                    return {
                        price_data: {
                            currency: "usd",
                            product_data: {
                                name: productName,
                            },
                            unit_amount: unitPrice * 100,
                        },
                        quantity: quantity,
                    }
                }),
                payment_intent_data: {
                    /* 3% of OrderTotal in Cents */
                    application_fee_amount: Math.round(3 * cartData.orderTotal),
                    /* To be used in case of destination charge */
                    // transfer_data: {
                    //     destination: CONNECTED_ACCOUNT_ID
                    // },
                },
                mode: "payment",
                success_url: STRIPE_ENV.CHECKOUT.SUCCESS_URL,
                cancel_url: STRIPE_ENV.CHECKOUT.CANCEL_URL,
            }, {
                stripeAccount: CONNECTED_ACCOUNT_ID
            })

        } catch (e) {
            // If there is an error send it to the client
            console.error(`Stripe error: ${e}`)
            throw new rest.RestError(RestStatus.BAD_REQUEST, `Stripe error: ${e.message}`)
        }
    }

    static getPaymentSession(session_id, CONNECTED_ACCOUNT_ID) {
        try {
            return stripe.checkout.sessions.retrieve(session_id, {
                stripeAccount: CONNECTED_ACCOUNT_ID
            });
        } catch (error) {
            console.error(`Stripe error: ${e}`)
            throw new rest.RestError(RestStatus.BAD_REQUEST, `Stripe error: ${e.message}`)
        }
    }

    static generateStripeAccountId(type = 'standard') {
        try {
            return stripe.accounts.create({ type });
        } catch (error) {
            console.error(`Stripe error: ${e}`)
            throw new rest.RestError(RestStatus.BAD_REQUEST, `Stripe error: ${e.message}`)
        }
    }

    static generateStripeAccountConnectLink(stripeAccountId) {
        try {
            return stripe.accountLinks.create({
                account: stripeAccountId,
                refresh_url: STRIPE_ENV.ACCOUNT_ONBOARDING.REFRESH_URL,
                return_url: STRIPE_ENV.ACCOUNT_ONBOARDING.RETURN_URL,
                type: 'account_onboarding',
            });
        } catch (error) {
            console.error(`Stripe error: ${e}`)
            throw new rest.RestError(RestStatus.BAD_REQUEST, `Stripe error: ${e.message}`)
        }
    }

    static getStripeConnectAccountDetail(accountId) {
        try {
            return stripe.accounts.retrieve(accountId)
        } catch (error) {
            console.error(`Stripe error: ${e}`)
            throw new rest.RestError(RestStatus.BAD_REQUEST, `Stripe error: ${e.message}`)
        }
    }
}

export default StripeService
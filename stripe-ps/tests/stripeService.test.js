import bodyParser from 'body-parser';
import request from 'supertest';
import express from 'express';
import stripService from '../StripeService/index';
import dotenv from 'dotenv';
dotenv.config();

const app = new express();
app.use(bodyParser.json());
app.use('/stripe', stripService);

const testAccountId = process.env.TEST_ACCT_ID;
const marketplaceUrl = process.env.MARKETPLACE_URL;
const testSessionId = process.env.TEST_SESSION_ID;
const testSellerId = process.env.TEST_SELLER_ID;

describe('Stripe Endpoint Tests', function() {

  it('Onboard without accountId', async () => {
    const res = await request(app)
      .get('/stripe/onboard')
      .set('referer', marketplaceUrl);
    expect(res.statusCode).toBe(200);
  });

  it('Onboard with accountId', async () => {
    const res = await request(app)
      .get(`/stripe/onboard/${testAccountId}`)
      .set('referer', marketplaceUrl);
    expect(res.statusCode).toBe(200);
  });

  it('Check the status of a Stripe account', async () => {
    const res = await request(app)
      .get(`/stripe/status/${testAccountId}`);
    expect(res.statusCode).toBe(200);
  });

  it('Checkout endpoint should return checkout url', async () => {
    const res = await request(app)
      .post('/stripe/checkout')
      .set('referer', marketplaceUrl)
      .send({ 
        paymentTypes: ['card', 'us_bank_account'], 
        cartData: {
          buyerOrganization: 'TestOrg',
          orderList: [{
            quantity: 1,
            assetAddress: '0',
            firstSale: true,
            unitPrice: 123
          }],
          orderTotal: 123,
          shippingAddressId: 1,
          tax: 0,
          user: 'user',
          email: 'user'
        }, 
        orderDetail: [{
          productName: 'Test',
          unitPrice: '123',
          quantity: 1
        }],
        accountId: testAccountId 
      });
    expect(res.statusCode).toBe(200);
  });

  if (testSellerId && testSessionId) {
    console.log('Running optional session and intent tests');

    it('Retrieve the Stripe session given sessionId', async () => {
      const res = await request(app)
        .get(`/stripe/session/${testSessionId}/${testSellerId}`);
      expect(res.statusCode).toBe(200);
    });

    it('Retrieve the Stripe intent given sessionId', async () => {
      const res = await request(app)
        .get(`/stripe/intent/${testSessionId}/${testSellerId}`);
      expect(res.statusCode).toBe(200);
    });
  }
  else {
    console.log('Skipping optional session and intent tests');
  }

})
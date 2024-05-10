import bodyParser from 'body-parser';
import request from 'supertest';
import express from 'express';
import stripService from '../StripeService/index';
import dotenv from 'dotenv';
dotenv.config();

const app = new express();
app.use(bodyParser.json());
app.use('/stripe', stripService);

const testAccountId = process.env.TEST_ACCOUNT_ID;
const testSessionId = process.env.TEST_SESSION_ID;

describe('Stripe Endpoint Tests', function() {

  it('Onboard without accountId', async () => {
    const res = await request(app)
      .get('/stripe/onboard')
      .set('referer', 'http://0.0.0.0');
    expect(res.statusCode).toBe(200);
  });

  it('Onboard with accountId', async () => {
    const res = await request(app)
      .get(`/stripe/onboard/${testAccountId}`)
      .set('referer', 'http://0.0.0.0');
    expect(res.statusCode).toBe(200);
  });

  it('Should not be able to onboard with invalid accountId', async () => {
    const res = await request(app)
      .get('/stripe/onboard/fake_account')
      .set('referer', 'http://0.0.0.0');
    expect(res.statusCode).toBe(400);
  });

  it('Check the status of a Stripe account', async () => {
    const res = await request(app)
      .get(`/stripe/status/${testAccountId}`);
    expect(res.statusCode).toBe(200);
  });

  it('Should not be able to check the status of an invalid accountId', async () => {
    const res = await request(app)
      .get('/stripe/status/fake_account');
    expect(res.statusCode).toBe(403);
  });

  it('Checkout endpoint should return checkout url', async () => {
    const res = await request(app)
      .post('/stripe/checkout')
      .set('referer', 'http://0.0.0.0')
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

  it('Should return an error when trying to checkout with malformed data', async () => {
    const res = await request(app)
      .post('/stripe/checkout')
      .set('referer', 'http://0.0.0.0')
      .send({ 
        paymentTypes: ['card', 'us_bank_account']
      });
    expect(res.statusCode).toBe(500);
  });

  it('Should return an error when requesting session with invalid info', async () => {
    const res = await request(app)
      .get('/stripe/session/fake_session/fake_account');
    expect(res.statusCode).toBe(403);
  });

  it('Should return an error when requesting intent with invalid info', async () => {
    const res = await request(app)
      .get('/stripe/intent/fake_session/fake_account');
    expect(res.statusCode).toBe(403);
  });

  if (testAccountId && testSessionId) {

    it('Retrieve the Stripe session given sessionId', async () => {
      const res = await request(app)
        .get(`/stripe/session/${testSessionId}/${testAccountId}`);
      expect(res.statusCode).toBe(200);
    });

    it('Retrieve the Stripe intent given sessionId', async () => {
      const res = await request(app)
        .get(`/stripe/intent/${testSessionId}/${testAccountId}`);
      expect(res.statusCode).toBe(200);
    });
  }
  else {
    console.log('Skipping optional session and intent tests');
  }

})
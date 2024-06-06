import bodyParser from 'body-parser';
import request from 'supertest';
import express from 'express';
import stripService from '../StripeService/index';
import dotenv from 'dotenv';
dotenv.config();

const app = new express();
app.use(bodyParser.json());
app.use('/stripe', stripService);

if (process.env.TEST_MODE !== 'true') {
  throw new Error(`TEST_MODE must be set to true.`);
}

describe('Stripe Endpoint Tests', function() {

  it('Onboard the Test user', async () => {
    const res = await request(app)
      .get('/stripe/onboard?username=Test&redirectUrl=http://localhost');
    expect(res.statusCode).toBe(302);
  });

  it('Check the status of a Stripe account', async () => {
    const res = await request(app)
      .get(`/stripe/status?username=Test`);
    expect(res.statusCode).toBe(200);
  });

  it('Should not be able to check the status of an invalid accountId', async () => {
    const res = await request(app)
      .get('/stripe/status?username=BadTest');
    expect(res.statusCode).toBe(500);
  });

  // Need to rethink checkout test
  // it('Checkout endpoint should return checkout url', async () => {
  //   const res = await request(app)
  //     .post('/stripe/checkout')
  //     .set('referer', 'http://0.0.0.0')
  //     .send({ 
  //       paymentTypes: ['card', 'us_bank_account'], 
  //       cartData: {
  //         buyerOrganization: 'TestOrg',
  //         orderList: [{
  //           quantity: 1,
  //           assetAddress: '0',
  //           firstSale: true,
  //           unitPrice: 123
  //         }],
  //         orderTotal: 123,
  //         shippingAddressId: 1,
  //         tax: 0,
  //         user: 'user',
  //         email: 'user'
  //       }, 
  //       orderDetail: [{
  //         productName: 'Test',
  //         unitPrice: '123',
  //         quantity: 1
  //       }],
  //       accountId: testAccountId 
  //     });
  //   expect(res.statusCode).toBe(200);
  // });

  it('Should return an error when trying to checkout with a bad token', async () => {
    const res = await request(app)
      .get('/stripe/checkout/badtoken?redirectUrl=http://localhost');
    expect(res.statusCode).toBe(500);
  });

})
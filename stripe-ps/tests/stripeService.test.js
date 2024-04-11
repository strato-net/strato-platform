import request from 'supertest';
import express from 'express';
import stripService from '../StripeService/index';

const app = new express();
app.use('/Stripe', stripService);

describe('Stripe Endpoint Tests', function() {
  test('Able to onboard a user without account Id', async () => {
    const res = await request(app).get('/Stripe/onboard');
    console.log(res);
    expect(res.statusCode).toBe(200);
  })
})
import bodyParser from 'body-parser';
import request from 'supertest';
import express from 'express';
import redemption from '../Redemptions';
import customerAddress from '../CustomerAddress/index';
import dotenv from 'dotenv';
dotenv.config();

const app = new express();
app.use(bodyParser.json());
app.use('/redemption', redemption);
app.use('/customer', customerAddress);

if (process.env.TEST_MODE !== 'true') {
  throw new Error(`TEST_MODE must be set to true.`);
}

describe('Redemption Tests', function () {
  let testId;
  let testAddressId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/customer/address')
      .send({
        commonName: 'Test',
        name: 'BlockApps',
        zipcode: '11206',
        state: 'NY',
        city: 'Brooklyn',
        addressLine1: '315 Meserole St',
        addressLine2: '',
        country: 'USA'
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.id).not.toBeNull();
    testAddressId = res.body.id;
  });

  it('Able to create a new redemption request', async () => {
    const res = await request(app)
      .post('/redemption/create')
      .send({
        redemption_id: 1,
        quantity: 1,
        ownerComments: 'Some owner comments',
        issuerComments: '',
        ownerCommonName: 'Test',
        issuerCommonName: 'Issuer',
        assetAddresses: ['123'],
        assetName: 'Test',
        status: 1,
        shippingAddressId: testAddressId,
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.id).not.toBeNull();
    testId = res.body.id;
  });
  
  it('Able to get a redemption request from the given Id', async () => {
    const res = await request(app)
      .get(`/redemption/${testId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).not.toBeNull();
  });

  it('Able to return a list of outgoing redemption requests', async () => {
    const res = await request(app)
      .get(`/redemption/outgoing/Test`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).not.toBeNull();
  });

  it('Able to return a list of incoming redemption requests', async () => {
    const res = await request(app)
      .get(`/redemption/incoming/Issuer`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).not.toBeNull();
  });

  it('Able to close a redemption request', async () => {
    const res = await request(app)
      .put(`/redemption/close/${testId}`)
      .send({
        issuerComments: 'Some issuer comments',
        status: 3,
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).not.toBeNull();
  });

  it('Able to delete a redemption request', async () => {
    const res = await request(app)
      .delete(`/redemption/id/${testId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).not.toBeNull();
  });

  afterAll(async () => {
    const res = await request(app)
      .delete(`/customer/address/id/${testAddressId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.changes).toBe(1);
  })
})
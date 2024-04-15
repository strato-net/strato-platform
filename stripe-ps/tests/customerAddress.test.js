import bodyParser from 'body-parser';
import request from 'supertest';
import express from 'express';
import customerAddress from '../CustomerAddress/index';
import db from '../db/index.js';
import dotenv from 'dotenv';
dotenv.config();

const app = new express();
app.use(bodyParser.json());
app.use('/customer', customerAddress);

describe('Customer Address Database Tests', function () {

  it('Able to add an address for a user', async () => {
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
    expect(res.body).toStrictEqual({ message: 'success', id: 1 });
  });

  it('Should not add an address that is malformed', async () => {
    const res = await request(app)
      .post('/customer/address')
      .send({
        name: 'BlockApps',
        zipcode: '11206',
        state: 'NY',
        city: 'Brooklyn'
      });
    expect(res.statusCode).toBe(500);
  });

  it('Able to retrieve an address given the addressId', async () => {
    const res = await request(app)
      .get('/customer/address/id/1');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).not.toBeNull();
  });

  it('Should return no address given an addressId that does not exist', async () => {
    const res = await request(app)
      .get('/customer/address/id/100');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('Able to retrieve all address for a given common name', async () => {
    const res = await request(app)
      .get(`/customer/address/Test`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('Should return an empty list for a user with no addresses', async () => {
    const res = await request(app)
      .get(`/customer/address/Homeless`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
  
  it('Able to delete created addresses given an addressId', async () => {
    const res = await request(app)
      .delete('/customer/address/id/1');
    expect(res.statusCode).toBe(200);
    expect(res.body.changes).toBe(1);
  });

  it('Cannot delete an address for which its addressId does not exist', async () => {
    const res = await request(app)
      .delete('/customer/address/id/100');
    expect(res.statusCode).toBe(200);
    expect(res.body.changes).toBe(0);
  });

  afterAll(() => {
    db.run(`DROP TABLE IF EXISTS customer_address`, 
      (err) => {
        if (err) throw err;
    });
  })

})
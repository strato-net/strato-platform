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
    console.log(res.body);
    expect(res.statusCode).toBe(200);
  });

  it('Able to retrieve all address for a given common name', async () => {
    const res = await request(app)
      .get(`/customer/address/Test`);
    console.log(res.body);
    expect(res.statusCode).toBe(200);
  });

  it('Able to retrieve an address given the addressId', async () => {
    const res = await request(app)
      .get('/customer/address/id/1');
    console.log(res.body);
    expect(res.statusCode).toBe(200);
  });
  
  it('Able to delete created addresses given an addressId', async () => {
    const res = await request(app)
      .delete('/customer/address/id/1');
    console.log(res.body);
    expect(res.statusCode).toBe(200);

  });

  afterAll(() => {
    db.run(`DROP TABLE IF EXISTS customer_address`, 
      (err) => {
        if (err) throw err;
    });
  })

})
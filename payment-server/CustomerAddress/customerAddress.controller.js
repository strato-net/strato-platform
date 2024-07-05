import client from '../db/index.js';
import Joi from '@hapi/joi';
class CustomerAddressController {

  static async getAddresses(req, res, next) {
    try {
      if (!req.params.commonName) {
        throw new Error('Missing common name in GET request /address/:commonName');
      }

      const query = 'SELECT * FROM customer_address WHERE commonName = $1 ORDER BY createdDate DESC';
      const values = [req.params.commonName];

      const result = await client.query(query, values);

      // fix casing in columns
      const formattedRows = result.rows.map(row => {
        const newRow = {
          ...row,
          commonName: row["commonname"],
          createdDate: row["createddate"],
          addressLine1: row["addressline1"],
          addressLine2: row["addressline2"]
        }
        const { commonname, createddate, addressline1, addressline2, ...rest } = newRow;
        return rest;
      });

      res.status(200).json({
        message: 'success',
        data: formattedRows || [],
      });

      return next();
    } catch (error) {
      console.error('DB Error:', error.message);
      next(error);
    }
  }

  static async getAddress(req, res, next) {
    try {
      if (!req.params.id) {
        throw new Error('Missing address ID in GET request /address/:id');
      }

      const query = 'SELECT * FROM customer_address WHERE address_id = $1';
      const values = [req.params.id];

      const result = await client.query(query, values);

      // fix casing in columns
      const formattedRows = result.rows.map(row => {
        const newRow = {
          ...row,
          commonName: row["commonname"],
          createdDate: row["createddate"],
          addressLine1: row["addressline1"],
          addressLine2: row["addressline2"]
        }
        const { commonname, createddate, addressline1, addressline2, ...rest } = newRow;
        return rest;
      });

      res.status(200).json({
        message: 'success',
        data: formattedRows[0] || {},
      });

      return next();
    } catch (error) {
      console.error('DB Error:', error.message);
      next(error);
    }
  }

  static async addAddress(req, res, next) {
    try {
      CustomerAddressController.validateAddAddressArgs(req.body);

      const { commonName, name, zipcode, state, city, addressLine1, addressLine2, country } = req.body;

      const query = `
        INSERT INTO customer_address (
          commonName, 
          name, 
          zipcode, 
          state, 
          city, 
          addressLine1, 
          addressLine2, 
          country
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        ) RETURNING address_id;`;

      const values = [commonName, name, zipcode, state, city, addressLine1, addressLine2, country];

      const result = await client.query(query, values);

      const addressId = result.rows[0].address_id;

      res.status(200).json({
        message: 'success',
        id: addressId,
      });

      return next();
    } catch (error) {
      console.error('DB Error:', error.message);
      next(error);
    }
  }

  static async deleteAddress(req, res, next) {
    try {
      if (!req.params.id) {
        throw new Error('Missing address ID in DELETE request /address/delete/:id');
      }

      const query = 'DELETE FROM customer_address WHERE address_id = $1';
      const values = [req.params.id];

      const result = await client.query(query, values);

      res.status(200).json({
        message: 'deleted',
        changes: result.rowCount,
      });

      return next();
    } catch (error) {
      console.error('DB Error:', error.message);
      next(error);
    }
  }

  // ********* VALIDATION ***********
  static validateAddAddressArgs(args) {
    const addAddressSchema = Joi.object({
      commonName: Joi.string().required(),
      name: Joi.string().required(),
      zipcode: Joi.string().required(),
      state: Joi.string().required(),
      city: Joi.string().required(),
      addressLine1: Joi.string().required(),
      addressLine2: Joi.string().allow("").optional(),
      country: Joi.string().required(),
    });

    const validation = addAddressSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in POST request /address: ${validation.error.message}`);
    }
  }

}

export default CustomerAddressController;
// const db = require('../db');
const client = require('../db');
const Joi = require('@hapi/joi');
class CustomerAddressController {

  // static async getAddresses(req, res, next) {
  //   try {
  //     if (!req.params.commonName) {
  //       throw new Error('Missing common name in GET request /address/:commonName');
  //     }

  //     const sql = 'SELECT * FROM customer_address WHERE commonName = ? ORDER BY createdDate DESC';
  //     const params = [req.params.commonName];
  //     db.all(sql, params, (err, rows) => {
  // if (err) {
  //   throw new Error(`DB Error: ${err.message}`);
  // }
  //       res.status(200).json({
  //         'message': 'success',
  //         'data': rows ? rows : [],
  //       });
  //       return next();
  //     });
  //   } catch (e) {
  //     next(e);
  //   }
  // }
  static async getAddresses(req, res, next) {
    try {
      if (!req.params.commonName) {
        throw new Error('Missing common name in GET request /address/:commonName');
      }

      const query = 'SELECT * FROM customer_address WHERE commonName = $1 ORDER BY createdDate DESC';
      const values = [req.params.commonName];

      const result = await client.query(query, values);

      res.status(200).json({
        message: 'success',
        data: result.rows || [],
      });

      return next();
    } catch (error) {
      console.error('DB Error:', error.message);
      next(error);
    }
  }

  // static async getAddress(req, res, next) {
  //   try {
  //     if (!req.params.id) {
  //       throw new Error('Missing address ID in GET request /address/:id');
  //     }

  //     const sql = 'SELECT * FROM customer_address WHERE address_id = ?';
  //     const params = [req.params.id];
  //     db.get(sql, params, (err, row) => {
  //       if (err) {
  //         throw new Error(`DB Error: ${err.message}`);
  //       }
  //       res.status(200).json({
  //         'message': 'success',
  //         'data': row ? row : [],
  //       });
  //       return next();
  //     });
  //   } catch (e) {
  //     next(e);
  //   }
  // }
  static async getAddress(req, res, next) {
    try {
      if (!req.params.id) {
        throw new Error('Missing address ID in GET request /address/:id');
      }

      const query = 'SELECT * FROM customer_address WHERE address_id = $1';
      const values = [req.params.id];

      const result = await client.query(query, values);

      res.status(200).json({
        message: 'success',
        data: result.rows[0] || {},
      });

      return next();
    } catch (error) {
      console.error('DB Error:', error.message);
      next(error);
    }
  }

  // static async addAddress(req, res, next) {
  //   try {
  //     CustomerAddressController.validateAddAddressArgs(req.body);

  //     const { commonName,
  //       name,
  //       zipcode,
  //       state,
  //       city,
  //       addressLine1,
  //       addressLine2,
  //       country
  //     } = req.body;

  //     const sql = `
  //       INSERT INTO customer_address (
  //         commonName,
  //         name,
  //         zipcode,
  //         state,
  //         city,
  //         addressLine1,
  //         addressLine2,
  //         country
  //       ) VALUES (
  //         ?,?,?,?,?,?,?,?
  //       );
  //     `;
  //     const params = [commonName,
  //       name,
  //       zipcode,
  //       state,
  //       city,
  //       addressLine1,
  //       addressLine2,
  //       country
  //     ];
  //     db.run(sql, params, function (err, row) {
  //       if (err) {
  //         throw new Error(`DB Error: ${err.message}`);
  //       }
  //       res.status(200).json({
  //         'message': 'success',
  //         'id': this.lastID,
  //       });
  //       return next();
  //     });
  //   } catch (e) {
  //     next(e);
  //   }
  // }
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

      // Send success response
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

  // static async deleteAddress(req, res, next) {
  //   try {
  //     if (!req.params.id) {
  //       throw new Error('Missing address ID in DELETE request /address/delete/:id');
  //     }

  //     const sql = 'DELETE FROM customer_address WHERE address_id = ?';
  //     const params = [req.params.id];
  //     db.run(sql, params, function (err, row) {
  //       if (err) {
  //         throw new Error(`DB Error: ${err.message}`);
  //       }
  //       res.status(200).json({
  //         'message': 'deleted',
  //         'changes': this.changes,
  //       });
  //       return next();
  //     })
  //   } catch (e) {
  //     next(e);
  //   }
  // }
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

module.exports = CustomerAddressController;
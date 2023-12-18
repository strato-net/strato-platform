const db = require('../db');
const Joi = require('@hapi/joi');
class CustomerAddressController {

  static async getAddresses(req, res, next) {
    try {
      if (!req.params.commonName) {
        throw new Error('Missing common name in GET request /address/:commonName');
      }

      const sql = 'SELECT * FROM customer_address WHERE commonName = ? ORDER BY createdDate DESC';
      const params = [req.params.commonName];
      db.all(sql, params, (err, rows) => {
        if (err) {
          throw new Error(`DB Error: ${err.message}`);
        }
        res.status(200).json({
          'message': 'success',
          'data': rows ? rows : [],
        });
        return next();
      });
    } catch (e) {
      next(e);
    }
  }

  static async addAddress(req, res, next) {
    try {
      CustomerAddressController.validateAddAddressArgs(req.body);

      const { commonName, 
              name, 
              zipcode, 
              state, 
              city, 
              addressLine1, 
              addressLine2 
            } = req.body;

      const sql = `
        INSERT INTO customer_address (
          commonName,
          name,
          zipcode,
          state,
          city,
          addressLine1,
          addressLine2
        ) VALUES (
          ?,?,?,?,?,?,?
        );
      `;
      const params = [ commonName, 
                       name, 
                       zipcode, 
                       state, 
                       city, 
                       addressLine1, 
                       addressLine2
                      ];
      db.run(sql, params, function (err, row) {
        if (err) {
          throw new Error(`DB Error: ${err.message}`);
        }
        res.status(200).json({
          'message': 'success',
          'id': this.lastID,
        });
        return next();
      });
    } catch (e) {
      next(e);
    }
  }

  static async deleteAddress(req, res, next) {
    try {
      if (!req.params.id) {
        throw new Error('Missing address ID in DELETE request /address/delete/:id');
      }

      const sql = 'DELETE FROM customer_address WHERE address_id = ?';
      const params = [req.params.id];
      db.run(sql, params, function (err, row) {
        if (err) {
          throw new Error(`DB Error: ${err.message}`);
        }
        res.status(200).json({
          'message': 'deleted',
          'changes': this.changes,
        });
        return next();
      })
    } catch (e) {
      next(e);
    }
  }

  // ********* VALIDATION ***********
  static validateAddAddressArgs(args) {
    const addAddressSchema = Joi.object({
      commonName: Joi.string().required(),
      name: Joi.string().required(),
      zipcode: Joi.number().positive().required(),
      state: Joi.string().required(),
      city: Joi.string().required(),
      addressLine1: Joi.string().required(),
      addressLine2: Joi.string().allow("").optional(),
    });

    const validation = addAddressSchema.validate(args);

    if (validation.error) {
      throw new Error(`Missing args or bad format in POST request /address: ${validation.error.message}`);
    }
  }

}

module.exports = CustomerAddressController;
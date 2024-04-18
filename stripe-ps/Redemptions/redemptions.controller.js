const client = require('../db');
const Joi = require('@hapi/joi');
class RedemptionsController {

    static async getRedemptions(req, res, next) {
        try {
            if (!req.params.commonName) {
                throw new Error('Missing common name in GET request /:commonName');
            }

            const query = 'SELECT * FROM redemptions WHERE ownerCommonName = $1 ORDER BY createdDate DESC';
            const values = [req.params.commonName];

            const result = await client.query(query, values);

            // fix casing in columns
            const formattedRows = result.rows.map(row => {
                const newRow = {
                    ...row,
                    ownerComments: row["ownercomments"],
                    issuerComments: row["issuercomments"],
                    ownerCommonName: row["ownercommonname"],
                    issuerCommonName: row["issuercommonname"],
                    assetAddresses: row["assetaddresses"],
                    shippingAddressId: row["shippingaddressid"],
                    createdDate: row["createddate"]
                }
                const { ownercomments, issuercomments, ownercommonname, issuercommonname, assetaddresses, shippingaddressid, createddate, ...rest } = newRow;
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

    static async getRedemption(req, res, next) {
        try {
            if (!req.params.id) {
                throw new Error('Missing redemption ID in GET request /id/:id');
            }

            const query = 'SELECT * FROM redemptions WHERE redemption_id = $1';
            const values = [req.params.id];

            const result = await client.query(query, values);

            // fix casing in columns
            const formattedRows = result.rows.map(row => {
                const newRow = {
                    ...row,
                    ownerComments: row["ownercomments"],
                    issuerComments: row["issuercomments"],
                    ownerCommonName: row["ownercommonname"],
                    issuerCommonName: row["issuercommonname"],
                    assetAddresses: row["assetaddresses"],
                    shippingAddressId: row["shippingaddressid"],
                    createdDate: row["createddate"]
                }
                const { ownercomments, issuercomments, ownercommonname, issuercommonname, assetaddresses, shippingaddressid, createddate, ...rest } = newRow;
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

    static async createRedemption(req, res, next) {
        try {
            RedemptionsController.validateCreateRedemptionArgs(req.body);

            const { quantity, ownerComments, issuerComments, ownerCommonName, issuerCommonName, assetAddresses, shippingAddressId } = req.body;

            const query = `
            INSERT INTO redemptions (
            quantity, 
            ownerComments, 
            issuerComments, 
            ownerCommonName, 
            issuerCommonName, 
            assetAddresses, 
            shippingAddressId 
            ) VALUES (
            $1, $2, $3, $4, $5, $6, $7
            ) RETURNING redemption_id;`;

            const values = [quantity, ownerComments, issuerComments, ownerCommonName, issuerCommonName, assetAddresses, shippingAddressId];

            const result = await client.query(query, values);

            const redemptionId = result.rows[0].redemption_id;

            res.status(200).json({
                message: 'success',
                id: redemptionId,
            });

            return next();
        } catch (error) {
            console.error('DB Error:', error.message);
            next(error);
        }
    }

    static async deleteRedemptions(req, res, next) {
        try {
            if (!req.params.id) {
                throw new Error('Missing redemption ID in DELETE request /id/:id');
            }

            const query = 'DELETE FROM redemptions WHERE redemption_id = $1';
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
    static validateCreateRedemptionArgs(args) {
        const createRedemptionSchema = Joi.object({
            quantity: Joi.number().integer().greater(0).required(),
            ownerComments: Joi.string().allow(""),
            issuerComments: Joi.string().allow(""),
            ownerCommonName: Joi.string().required(),
            issuerCommonName: Joi.string().required(),
            assetAddresses: Joi.array().items(Joi.string()),
            shippingAddressId: Joi.number().integer().required(),
        });

        const validation = createRedemptionSchema.validate(args);

        if (validation.error) {
            throw new Error(`Missing args or bad format in POST request: ${validation.error.message}`);
        }
    }

}

module.exports = RedemptionsController;
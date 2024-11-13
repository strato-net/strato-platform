import client from '../db/index.js';
import Joi from '@hapi/joi';
import { REDEMPTION_CONTRACT_ADDRESS } from '../helpers/constants.js';
class RedemptionsController {

    static async getOutgoingRedemptionRequests(req, res, next) {
        try {
            if (!req.params.commonName) {
                throw new Error('Missing common name in GET request /:commonName');
            }

            let orderByClause = '';
            const {order, limit, offset } = req.query;

            if (order === 'ASC' || order === 'DESC') {
                orderByClause = `ORDER BY createdDate ${order} LIMIT ${limit} OFFSET ${offset}`;
            }

            const query = `SELECT * FROM redemptions WHERE ownerCommonName = $1 AND ($2 = '' OR redemption_id::text = $2) ${orderByClause}`;
            const countQuery = `SELECT COUNT(*) AS total_count FROM redemptions WHERE ownerCommonName = $1 AND ($2 = '' OR redemption_id::text = $2)`

            const values = [req.params.commonName, req.query.redemptionId];

            const result = await client.query(query, values);
            const count = await client.query(countQuery, values);

            // fix casing in columns
            const formattedRows = result.rows.map(row => {
                const date = new Date(row["createddate"]);
                const formattedDate = date.toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric'
                });

                const newRow = {
                    ...row,
                    ownerComments: row["ownercomments"],
                    issuerComments: row["issuercomments"],
                    ownerCommonName: row["ownercommonname"],
                    issuerCommonName: row["issuercommonname"],
                    assetAddresses: row["assetaddresses"],
                    assetName: row["assetname"],
                    shippingAddressId: row["shippingaddressid"],
                    redemptionService: REDEMPTION_CONTRACT_ADDRESS,
                    createdDate: formattedDate
                }
                const { ownercomments, issuercomments, ownercommonname, issuercommonname, assetaddresses, assetname, shippingaddressid, createddate, ...rest } = newRow;
                return rest;
            });

            res.status(200).json({
                message: 'success',
                data: formattedRows || [],
                count: count.rows[0].total_count
            });

            return next();
        } catch (error) {
            console.error('DB Error:', error.message);
            next(error);
        }
    }

    static async getIncomingRedemptionRequests(req, res, next) {
        try {
            if (!req.params.commonName) {
                throw new Error('Missing common name in GET request /:commonName');
            }

            let orderByClause = '';
            const {order, limit, offset } = req.query;

            if (order === 'ASC' || order === 'DESC') {
                orderByClause = `ORDER BY createdDate ${order} LIMIT ${limit} OFFSET ${offset}`;
            }

            const query = `SELECT * FROM redemptions WHERE issuerCommonName = $1 AND ($2 = '' OR redemption_id::text = $2) ${orderByClause}`;
            const countQuery = `SELECT COUNT(*) AS total_count FROM redemptions WHERE issuerCommonName = $1 AND ($2 = '' OR redemption_id::text = $2)`
            const values = [req.params.commonName, req.query.redemptionId];

            const result = await client.query(query, values);
            const count = await client.query(countQuery, values);

            // fix casing in columns
            const formattedRows = result.rows.map(row => {
                const date = new Date(row["createddate"]);
                const formattedDate = date.toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric'
                });

                const newRow = {
                    ...row,
                    ownerComments: row["ownercomments"],
                    issuerComments: row["issuercomments"],
                    ownerCommonName: row["ownercommonname"],
                    issuerCommonName: row["issuercommonname"],
                    assetAddresses: row["assetaddresses"],
                    assetName: row["assetname"],
                    shippingAddressId: row["shippingaddressid"],
                    redemptionService: REDEMPTION_CONTRACT_ADDRESS,
                    createdDate: formattedDate
                }
                const { ownercomments, issuercomments, ownercommonname, issuercommonname, assetaddresses, assetname, shippingaddressid, createddate, ...rest } = newRow;
                return rest;
            });

            res.status(200).json({
                message: 'success',
                data: formattedRows || [],
                count: count.rows[0].total_count
            });

            return next();
        } catch (error) {
            console.error('DB Error:', error.message);
            next(error);
        }
    }

    static async getAllRedemptionRequests(req, res, next) {
        try {

            let orderByClause = '';
            const {order, limit, offset } = req.query;

            if (order === 'ASC' || order === 'DESC') {
                orderByClause = `ORDER BY createdDate ${order} LIMIT ${limit} OFFSET ${offset}`;
            }

            const query = `SELECT * FROM redemptions ${orderByClause}`;
            const countQuery = `SELECT COUNT(*) AS total_count FROM redemptions`
            const result = await client.query(query);
            const count = await client.query(countQuery);

            // fix casing in columns
            const formattedRows = result.rows.map(row => {
                const date = new Date(row["createddate"]);
                const formattedDate = date.toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric'
                });

                const newRow = {
                    ...row,
                    ownerComments: row["ownercomments"],
                    issuerComments: row["issuercomments"],
                    ownerCommonName: row["ownercommonname"],
                    issuerCommonName: row["issuercommonname"],
                    assetAddresses: row["assetaddresses"],
                    assetName: row["assetname"],
                    shippingAddressId: row["shippingaddressid"],
                    redemptionService: REDEMPTION_CONTRACT_ADDRESS,
                    createdDate: formattedDate
                }
                const { ownercomments, issuercomments, ownercommonname, issuercommonname, assetaddresses, assetname, shippingaddressid, createddate, ...rest } = newRow;
                return rest;
            });

            res.status(200).json({
                message: 'success',
                data: formattedRows || [],
                count: count.rows[0].total_count
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
                throw new Error('Missing redemption ID in GET request /:id');
            }

            const query = 'SELECT * FROM redemptions WHERE redemption_id = $1';
            const values = [req.params.id];

            const result = await client.query(query, values);

            // fix casing in columns
            const formattedRows = result.rows.map(row => {
                const date = new Date(row["createddate"]);
                const formattedDate = date.toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric'
                });

                const newRow = {
                    ...row,
                    ownerComments: row["ownercomments"],
                    issuerComments: row["issuercomments"],
                    ownerCommonName: row["ownercommonname"],
                    issuerCommonName: row["issuercommonname"],
                    assetAddresses: row["assetaddresses"],
                    assetName: row["assetname"],
                    shippingAddressId: row["shippingaddressid"],
                    redemptionService: REDEMPTION_CONTRACT_ADDRESS,
                    createdDate: formattedDate
                }
                const { ownercomments, issuercomments, ownercommonname, issuercommonname, assetaddresses, assetname, shippingaddressid, createddate, ...rest } = newRow;
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

            const { redemption_id, quantity, ownerComments, issuerComments, ownerCommonName, issuerCommonName, assetAddresses, assetName, status, shippingAddressId } = req.body;

            const query = `
                INSERT INTO redemptions (
                    redemption_id,
                    quantity, 
                    ownerComments, 
                    issuerComments, 
                    ownerCommonName, 
                    issuerCommonName, 
                    assetAddresses, 
                    assetName,
                    status,
                    shippingAddressId 
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
                ) RETURNING redemption_id;
            `;

            const values = [redemption_id, quantity, ownerComments, issuerComments, ownerCommonName, issuerCommonName, assetAddresses, assetName, status, shippingAddressId];

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

    static async closeRedemption(req, res, next) {
        try {
            RedemptionsController.validateCloseRedemptionArgs(req.body);

            if (!req.params.id) {
                throw new Error('Missing redemption ID in PUT request /close/:id');
            }

            const { issuerComments, status } = req.body;

            const query = `
                UPDATE redemptions SET issuerComments = $1, status = $2 WHERE redemption_id = $3
            `;

            const values = [issuerComments, status, req.params.id];

            const result = await client.query(query, values);

            res.status(200).json({
                message: 'updated',
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
            redemption_id: Joi.number().integer().required(),
            quantity: Joi.number().integer().greater(0).required(),
            ownerComments: Joi.string().allow(""),
            issuerComments: Joi.string().allow(""),
            ownerCommonName: Joi.string().required(),
            issuerCommonName: Joi.string().required(),
            assetAddresses: Joi.array().items(Joi.string()),
            assetName: Joi.string().required(),
            status: Joi.number().integer().min(1).max(1).required(),
            shippingAddressId: Joi.number().integer().required(),
        });

        const validation = createRedemptionSchema.validate(args);

        if (validation.error) {
            throw new Error(`Missing args or bad format in POST request: ${validation.error.message}`);
        }
    }

    static validateCloseRedemptionArgs(args) {
        const closeRedemptionSchema = Joi.object({
            issuerComments: Joi.string().allow(""),
            status: Joi.number().integer().min(2).max(3).required()
        });

        const validation = closeRedemptionSchema.validate(args);

        if (validation.error) {
            throw new Error(`Missing args or bad format in PUT request: ${validation.error.message}`);
        }
    }

}

export default RedemptionsController;
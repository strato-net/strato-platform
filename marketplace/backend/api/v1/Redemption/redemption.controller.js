import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'

class RedemptionController {

    static async getRedemptionServices(req, res, next) {
        try {
            const { dapp, query } = req
            const redemptionServices = await dapp.getRedemptionServices(query)
            rest.response.status200(res, redemptionServices)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async get(req, res, next) {
        try {
            const { dapp, params, query } = req
            const { id } = params
            const { redemptionService } = query

            let args = { id, redemptionService }

            const redemption = await dapp.getRedemption(args)
            rest.response.status200(res, redemption)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async requestRedemption(req, res, next) {
        try {
            const { dapp, body } = req

            RedemptionController.validateRequestRedemptionArgs(body)

            const result = await dapp.requestRedemption(body)
            rest.response.status200(res, result)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getOutgoingRedemptionRequests(req, res, next) {
        try {
            const { dapp, query } = req

            const redemptions = await dapp.getOutgoingRedemptionRequests(query)
            rest.response.status200(res, redemptions)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getIncomingRedemptionRequests(req, res, next) {
        try {
            const { dapp, query } = req

            const redemptions = await dapp.getIncomingRedemptionRequests(query)
            rest.response.status200(res, redemptions)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async closeRedemption(req, res, next) {
        try {
            const { dapp, body } = req

            RedemptionController.validateCloseRedemptionArgs(body)

            const result = await dapp.closeRedemption(body)
            rest.response.status200(res, result)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    // ----------------------- ARG VALIDATION ------------------------

    static validateRequestRedemptionArgs(args) {
        const requestRedemptionSchema = Joi.object({
            assetAddresses: Joi.array().items(Joi.string()),
            assetName: Joi.string().required(),
            status: Joi.number().integer().min(1).max(1).required(),
            quantity: Joi.number().integer().greater(0).required(),
            shippingAddressId: Joi.number().integer().required(),
            ownerCommonName: Joi.string().required(),
            issuerCommonName: Joi.string().required(),
            ownerComments: Joi.string().allow(""),
            redemptionService: Joi.string(),
        });

        const validation = requestRedemptionSchema.validate(args);

        if (validation.error) {
            console.log('validation error: ', validation.error)
            throw new rest.RestError(RestStatus.BAD_REQUEST, validation.error.message, {
                message: `Missing args or bad format: ${validation.error.message}`,
            })
        }
    }

    static validateCloseRedemptionArgs(args) {
        const requestRedemptionSchema = Joi.object({
            id: Joi.number().integer().required(),
            assetAddresses: Joi.array().items(Joi.string()),
            status: Joi.number().integer().min(2).max(3).required(),
            issuerComments: Joi.string().allow(""),
            redemptionService: Joi.string(),
            issuerCommonName: Joi.string().required()
        });

        const validation = requestRedemptionSchema.validate(args);

        if (validation.error) {
            console.log('validation error: ', validation.error)
            throw new rest.RestError(RestStatus.BAD_REQUEST, validation.error.message, {
                message: `Missing args or bad format: ${validation.error.message}`,
            })
        }
    }

}

export default RedemptionController

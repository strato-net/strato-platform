import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import { getSignedUrlFromS3, deleteFileFromS3 } from '../../../helpers/s3'
import constants from '../../../helpers/constants'

const options = { config, cacheNonce: true }

class VintageController {

    static async get(req, res, next) {
        try {
            const { dapp, params } = req
            const { address } = params

            let args
            let chainOptions = options

            if (address) {
                args = { address }
                chainOptions = { ...options }
            }

            const vintage = await dapp.getVintage(args, chainOptions)
            rest.response.status200(res, vintage)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getAll(req, res, next) {
        try {
            const { dapp, query } = req

            const vintages = await dapp.getVintages({ ...query })

            rest.response.status200(res, vintages)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async create(req, res, next) {
        try {
            const { dapp, body } = req

            VintageController.validateCreateVintageArgs(body)

            const vintage = await dapp.createVintage(body)
            rest.response.status200(res, vintage)

            return next()
        } catch (e) {
            return next(e)
        }
    }


    // ----------------------- ARG VALIDATION ------------------------

    static validateCreateVintageArgs(args) {
        const createVintageSchema = Joi.object({
            productAddress: Joi.string().required(),
            vintage: Joi.number().integer().min(2020).max(2040).allow(0),
            bufferAmount: Joi.number().integer().required(),
            estimatedReductionAmount: Joi.number().integer().required(),
            actualReductionAmount: Joi.number().integer().required(),
            verifier: Joi.string().required(),
            availableQuantity: Joi.number().integer().min(0).required(),
            pricePerUnit: Joi.number().integer().greater(0).required(),
            status: Joi.number().integer().min(1).max(2).required(),
        });

        const validation = createVintageSchema.validate(args);

        if (validation.error) {
            throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Vintage Argument Validation Error', {
                message: `Missing args or bad format: ${validation.error.message}`,
            })
        }
    }

}

export default VintageController;
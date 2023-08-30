import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import { getSignedUrlFromS3, deleteFileFromS3 } from '../../../helpers/s3'
import constants from '../../../helpers/constants'

const options = { config, cacheNonce: true }

class CarbonController {

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

            const carbon = await dapp.getCarbon(args, chainOptions)
            rest.response.status200(res, carbon)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getAll(req, res, next) {
        try {
            const { dapp, query } = req

            const carbons = await dapp.getCarbons({ ...query })

            rest.response.status200(res, carbons)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async create(req, res, next) {
        try {
            const { dapp, body } = req

            CarbonController.validateCreateCarbonArgs(body)

            const carbon = await dapp.createCarbon(body)
            rest.response.status200(res, carbon)

            return next()
        } catch (e) {
            return next(e)
        }
    }


    // ----------------------- ARG VALIDATION ------------------------

    static validateCreateCarbonArgs(args) {
        const createCarbonSchema = Joi.object({
            productArgs: Joi.object({
                name: Joi.string().required(),
                description: Joi.string().required(),
                imageKey: Joi.string().required(),
                isActive: Joi.boolean().required(),
                category: Joi.string().required(),
            }),
            projectType: Joi.string().required(),
            methodology: Joi.string().required(),
            projectCountry: Joi.string().required(),
            projectCategory: Joi.string().required(),
            projectDeveloper: Joi.string().required(),
            dMRV: Joi.string().required(),
            registry: Joi.string().required(),
            creditType: Joi.string().required(),
            sdg: Joi.string().required(),
            validator: Joi.string().required(),
            eligibility: Joi.string().required(),
            permanenceType: Joi.string().required(),
            reductionType: Joi.string().required(),
            unit: Joi.string().required(),
            currency: Joi.string().required(),
            divisibility: Joi.number().integer().min(0).required()
        });

        const validation = createCarbonSchema.validate(args);

        if (validation.error) {
            throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Carbon Argument Validation Error', {
                message: `Missing args or bad format: ${validation.error.message}`,
            })
        }
    }

}

export default CarbonController;
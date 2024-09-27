import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import constants from '../../../helpers/constants'
const options = { config, cacheNonce: true }

class OfferController {
    static async get(req, res, next) {
        try {
            const { dapp, params } = req
            const { address } = params

            let args;
            let chainOptions = options;

            if (address) {
                args = { address }
            }

            const order = await dapp.getOffer(args, chainOptions);

            const assetsWithImageUrl = order.assets
            const result = { ...order, assets: assetsWithImageUrl }
            rest.response.status200(res, result)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getAll(req, res, next) {
        try {
            const { dapp, query } = req
            const offers = await dapp.getAllOffers({ ...query });
            rest.response.status200(res, offers)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async create(req, res, next) {
        try {
            const { dapp, body } = req
            console.log("Checking Controller ===> ", body);
            OfferController.validateCreateOfferArgs(body)

            const result = await dapp.createOffer(body, options)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async update(req, res, next) {
        try {
            const { dapp, body } = req
            const result = await dapp.updateOffer(body, options)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async accept(req, res, next) {
        try {
            const { dapp, body } = req
            const result = await dapp.acceptOrder(body, options)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async reject(req, res, next) {
        try {
            const { dapp, body } = req
            const result = await dapp.rejectOffer(body, options)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async cancel(req, res, next) {
        try {
            const { dapp, body } = req
            const result = await dapp.cancelOffer(body, options)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getIncomingOffers(req, res, next) {
        try {
            const { dapp, query } = req
            const result = await dapp.getIncomingOffers({ ...query });

            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getOutgoingOffers(req, res, next) {
        try {
            const { dapp, query } = req
            const result = await dapp.getOutgoingOffers({ ...query });

            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static validateCreateOfferArgs(args) {
        const createOfferSchema = Joi.object({
            assetAddress: Joi.string().required(),
            saleAddress: Joi.string().required(),
            quantity: Joi.number().min(1).required(),
            price: Joi.number().min(1).required(),
            imageUrl: Joi.string().required(),
        }).required()

        const validation = createOfferSchema.validate(args)

        if (validation.error) {
            throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Offer Argument Validation Error', {
                message: `Missing args or bad format: ${validation.error.message}`,
            })
        }
    }
}

export default OfferController
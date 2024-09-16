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

            const order = await dapp.getOrder(args, chainOptions);

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
            const { orders, total } = await dapp.getSaleOrders({ ...query });

            rest.response.status200(res, { orders, total })
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async create(req, res, next) {
        try {
            const { dapp, body } = req
            const { order } = body
            const result = await dapp.createOrder({ order }, options)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async update(req, res, next) {
        try {
            const { dapp, body } = req
            const { order } = body
            const result = await dapp.updateOrder({ order }, options)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async accept(req, res, next) {
        try {
            const { dapp, body } = req
            const { order } = body
            const result = await dapp.acceptOrder({ order }, options)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async reject(req, res, next) {
        try {
            const { dapp, body } = req
            const { order } = body
            const result = await dapp.rejectOrder({ order }, options)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async cancel(req, res, next) {
        try {
            const { dapp, body } = req
            const { order } = body
            const result = await dapp.cancelOrder({ order }, options)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getIncomingOffers(req, res, next) {
        try {
            const { dapp, query } = req
            const { orders, total } = await dapp.getIncomingOffers({ ...query });

            rest.response.status200(res, { orders, total })
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getOutgoingOffers(req, res, next) {
        try {
            const { dapp, query } = req
            const { orders, total } = await dapp.getOutgoingOffers({ ...query });

            rest.response.status200(res, { orders, total })
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getAcceptedOffers(req, res, next) {
        try {
            const { dapp, query } = req
            const { orders, total } = await dapp.getAcceptedOffers({ ...query });

            rest.response.status200(res, { orders, total })
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getRejectedOffers(req, res, next) {
        try {
            const { dapp, query } = req
            const { orders, total } = await dapp.getRejectedOffers({ ...query });

            rest.response.status200(res, { orders, total })
            return next()
        } catch (e) {
            return next(e)
        }
    }

    static async getCancelledOffers(req, res, next) {
        try {
            const { dapp, query } = req
            const { orders, total } = await dapp.getCancelledOffers({ ...query });

            rest.response.status200(res, { orders, total })
            return next()
        } catch (e) {
            return next(e)
        }
    }
}

export default OfferController
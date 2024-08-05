import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'

class TransactionController {

    static async getAllTransactions(req, res, next) {
        try {
            const { dapp, params, query } = req
            const { id } = params
            const { transactionService , userName } = query

            let args = { id, transactionService }

            const transaction = await dapp.getTransaction(args)
            rest.response.status200(res, transaction)

            return next()
        } catch (e) {
            return next(e)
        }
    }

    // ----------------------- ARG VALIDATION ------------------------

    static validateRequestTransactionArgs(args) {
        const requestTransactionSchema = Joi.object({
            assetAddresses: Joi.array().items(Joi.string()),
            assetName: Joi.string().required(),
            status: Joi.number().integer().min(1).max(1).required(),
            quantity: Joi.number().integer().greater(0).required(),
            shippingAddressId: Joi.number().integer().required(),
            ownerCommonName: Joi.string().required(),
            issuerCommonName: Joi.string().required(),
            ownerComments: Joi.string().allow(""),
            transactionService: Joi.string(),
        });

        const validation = requestTransactionSchema.validate(args);

        if (validation.error) {
            console.log('validation error: ', validation.error)
            throw new rest.RestError(RestStatus.BAD_REQUEST, validation.error.message, {
                message: `Missing args or bad format: ${validation.error.message}`,
            })
        }
    }

    static validateCloseTransactionArgs(args) {
        const requestTransactionSchema = Joi.object({
            id: Joi.number().integer().required(),
            assetAddresses: Joi.array().items(Joi.string()),
            status: Joi.number().integer().min(2).max(3).required(),
            issuerComments: Joi.string().allow(""),
            transactionService: Joi.string(),
        });

        const validation = requestTransactionSchema.validate(args);

        if (validation.error) {
            console.log('validation error: ', validation.error)
            throw new rest.RestError(RestStatus.BAD_REQUEST, validation.error.message, {
                message: `Missing args or bad format: ${validation.error.message}`,
            })
        }
    }

}

export default TransactionController

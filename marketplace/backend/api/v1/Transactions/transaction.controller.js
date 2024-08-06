import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'

class TransactionController {

    static async getAllTransactions(req, res, next) {
        try {
            const { dapp, params, query } = req
            
            const user = 'tanujsoni53'
            let transactionQuery = {
                limit: '10',
                offset: '0',
                order: 'createdDate.desc',
                or: `(sellersCommonName.eq.${user},purchasersCommonName.eq.${user})`
            }

            const redemptionQuery = {
                limit:'10',
                offset:'0',
                order: 'DESC',
                search: ''
            }

            const TransferQuery = {
                limit:'10',
                offset:'0',
                or:'(oldOwnerCommonName.eq.tanujsoni53,newOwnerCommonName.eq.tanujsoni53)',
                order:'transferDate.desc'
                }

            const { orders, total } = await dapp.getSaleOrders({ ...transactionQuery });
            transactionQuery['or'] = `(oldOwnerCommonName.eq.${user},newOwnerCommonName.eq.${user})`
            const itemTransfers = await dapp.getAllItemTransferEvents(TransferQuery);
            const outgoingRedemptions = await dapp.getOutgoingRedemptionRequests(redemptionQuery)
            const incomingRedemptions = await dapp.getIncomingRedemptionRequests(redemptionQuery)

            console.log("itemTransfers",itemTransfers, "outgoingRedemptions",outgoingRedemptions, "incomingRedemptions", incomingRedemptions);

            // rest.response.status200(res, transaction)
            res.status(200).json({ success: true, message: "test successful" })


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

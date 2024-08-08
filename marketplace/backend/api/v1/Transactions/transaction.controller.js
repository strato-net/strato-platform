import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'

class TransactionController {

    static async getAllTransactions(req, res, next) {
        try {
            const { dapp, params, query } = req
            const { limit='2000', offset='0', order, search='', type, user } = query;
            let transactionQuery = {
                limit: limit,
                offset: offset,
                order: 'createdDate.desc',
                or: `(sellersCommonName.eq.${user},purchasersCommonName.eq.${user})`,
                id: search
            }

            const redemptionQuery = {
                limit: limit,
                offset: offset,
                order: 'DESC',
                search: search
            }

            const TransferQuery = {
                limit: limit,
                offset: offset,
                or: `(oldOwnerCommonName.eq.${user},newOwnerCommonName.eq.${user})`,
                order: 'transferDate.desc',
                id: search
            }
            let orderData,  itemTransfers,  outgoingRedemptions, incomingRedemptions
            let data = []
            if(type==='Order' || !type){
                orderData = await dapp.getSaleOrders({ ...transactionQuery });
                data = [...data, ...orderData.orders]
            }
            if(type==='Transfer' || !type){
            itemTransfers = await dapp.getAllItemTransferEvents(TransferQuery);
            data = [...data, ...itemTransfers.transfers]
            }
            if(type==='Redemption' || !type){
                outgoingRedemptions = await dapp.getOutgoingRedemptionRequests(redemptionQuery)
                incomingRedemptions = await dapp.getIncomingRedemptionRequests(redemptionQuery)
                data = [...data, ...outgoingRedemptions, ...incomingRedemptions]
            }

            const sortData = data.sort((a, b) => (b?.createdDate || b?.transferDate || b?.redemptionDate) - (a?.createdDate || a?.transferDate || a?.redemptionDate));
            const newData = sortData.map((item)=>({ ...item,
                from: item.oldOwnerCommonName || item.sellersCommonName || item.ownerCommonName, 
                to: item.newOwnerCommonName || item.purchasersCommonName || item.issuerCommonName,
                price: item.price || item.totalPrice || 'null',
                status: item.status || '1',
                reference: item.id || item.orderId || item.redemption_id,
                // quantity: item.quantity || item.BlockApps-Mercata-Order-quantities[0]?.value,
                quantity: item?.quantity || 'null'
                // || (item?.quantities?.length !==0 && item?.quantities[0]) || (item['BlockApps-Mercata-Order-quantities'][0]?.value)   || 'null', //TODO: remove the zero and use logic for this
                
            })) 
            // rest.response.status200(res, transaction)
            res.status(200).json({ success: true, message: "Fetched Transactions successfully", data: newData })
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

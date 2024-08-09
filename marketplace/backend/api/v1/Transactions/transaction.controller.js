import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'

const getItemQuantity = (item) => {
    if (item.quantity) {
        return item.quantity;
    } else if (item.quantities?.length) {
        return item.quantities[0]
    } else if (item['BlockApps-Mercata-Order-quantities']?.length) {
        return item['BlockApps-Mercata-Order-quantities'][0]?.value
    } else {
        return 'null'
    }
}
class TransactionController {

    static async getAllTransactions(req, res, next) {
        try {
            const { dapp, params, query } = req
            const { limit = '2000', offset = '0', order, search = '', type, user } = query;
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
            let orderData, itemTransfers, outgoingRedemptions, incomingRedemptions
            let data = []
            if (type === 'Order' || !type) {
                orderData = await dapp.getSaleOrders({ ...transactionQuery });
                data = [...data, ...orderData.orders]
            }
            if (type === 'Transfer' || !type) {
                itemTransfers = await dapp.getAllItemTransferEvents(TransferQuery);
                data = [...data, ...itemTransfers.transfers]
            }
            if (type === 'Redemption' || !type) {
                outgoingRedemptions = await dapp.getOutgoingRedemptionRequests(redemptionQuery)
                incomingRedemptions = await dapp.getIncomingRedemptionRequests(redemptionQuery)
                data = [...data, ...outgoingRedemptions, ...incomingRedemptions]
            }
            let assetAddress = data.filter((item)=>{
                if(item.assetAddress){
                    return item.assetAddress
                }else if(item.assetAddresses){
                   return item.assetAddresses[0]
                }
            })

            assetAddress = assetAddress.map((item)=>item.assetAddress || item.assetAddresses[0])
            assetAddress = [...new Set(assetAddress)]

            const queryData = {address: assetAddress, limit:2000, offset:0 }
            const inventories = await dapp.getAllInventories({ ...queryData })
            const inventoriesWithImageUrl = inventories?.inventories

            const sortData = data.sort((a, b) => (b?.createdDate || b?.transferDate || b?.redemptionDate) - (a?.createdDate || a?.transferDate || a?.redemptionDate));
            const newData = sortData.map((item) => {

                const asset = inventoriesWithImageUrl.find((assetItem)=>{
                    if(item.type==='Order'){}
                      else{
                    return (assetItem.address === (item?.assetAddress || item?.assetAddresses[0]))
                      }
                });

                const getImage=(asset)=> {
                    if(asset && asset["BlockApps-Mercata-Asset-images"] ){
                        return asset["BlockApps-Mercata-Asset-images"][0].value;
                    }else {
                        return ''
                    }
                }

                return {
                ...item,
                from: item.oldOwnerCommonName || item.sellersCommonName || item.ownerCommonName,
                to: item.newOwnerCommonName || item.purchasersCommonName || item.issuerCommonName,
                price: item.price || item.totalPrice || 'null',
                status: item.status || '1',
                reference: item.id || item.orderId || item.redemption_id,
                quantity: getItemQuantity(item),
                assetName:asset?.name || "null",
                assetDescription:asset?.description || 'null',
                assetImage:getImage(asset),
                category:asset?.category || 'null',
                assetPrice:'null'
            }});
            // rest.response.status200(res, transaction)
            res.status(200).json({ success: true, message: "Fetched Transactions successfully", data: newData })
            return next()
        } catch (e) {
            return next(e)
        }
    }

}

export default TransactionController

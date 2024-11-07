

const getItemQuantity = (item) => {
    if (item.quantity) {
        return item.quantity;
    } else if (item.quantities?.length) {
        return item.quantities[0]
    } else if (item['BlockApps-Mercata-Order-quantities']?.length) {
        return item['BlockApps-Mercata-Order-quantities'][0]?.value
    } else {
        return ''
    }
}
class TransactionController {

    static async getAllTransactions(req, res, next) {
        try {
            const { dapp, params, query } = req
            const { limit = '2000', offset = '0', order, search = '', type, user, startDate, endDate } = query;
            let transactionQuery = {
                limit: limit,
                offset: offset,
                order: 'createdDate.desc',
                or: `(sellersCommonName.eq.${user},purchasersCommonName.eq.${user})`,
                id: search,
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
            if(startDate && endDate){
                transactionQuery['range'] = [`createdDate,${startDate},${endDate}`]
                redemptionQuery['range'] = [`redemptionDate,${startDate},${endDate}`]
                TransferQuery['range'] = [`transferDate,${startDate},${endDate}`]
            }

            let orderData, itemTransfers, outgoingRedemptions, incomingRedemptions
            let data = []
            if (type === 'Order' || !type) {
                orderData = await dapp.getSaleOrders({ ...transactionQuery });
                data = [...data, ...orderData]
            }
            if (type === 'Transfer' || !type) {
                itemTransfers = await dapp.getAllItemTransferEvents(TransferQuery);
                data = [...data, ...itemTransfers.transfers]
            }
            if (type === 'Redemption' || !type) {
                outgoingRedemptions = await dapp.getOutgoingRedemptionRequests(redemptionQuery)
                incomingRedemptions = await dapp.getIncomingRedemptionRequests(redemptionQuery)
                let redemptions = [...outgoingRedemptions, ...incomingRedemptions];
                redemptions = redemptions.filter((value, index, self) =>
                    index === self.findIndex((t) => (
                        t.redemption_id === value.redemption_id
                    ))
                );
                data = [...data, ...redemptions]
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
            const sortData = data.sort((a, b) => ( b?.transferDate || b?.redemptionDate || b?.createdDate) - ( a?.transferDate || a?.redemptionDate || a?.createdDate));
            const newData = sortData.map((item) => {
                const asset = inventoriesWithImageUrl.find((assetItem)=>{
                    return (assetItem.address === (item?.assetAddress || item?.assetAddresses[0]))
                });

                const getImage=(assetItem)=> {
                    if(assetItem && assetItem["BlockApps-Mercata-Asset-images"]?.length ){
                        return assetItem["BlockApps-Mercata-Asset-images"][0].value;
                    }else if (item.image){
                        return item.image;
                    }else{
                        return ''
                    }
                }

                return {
                ...item,
                createdDate: item.transferDate || item.redemptionDate || item.createdDate,
                from: item.oldOwnerCommonName || item.purchasersCommonName || item.ownerCommonName,
                to: item.newOwnerCommonName || item.sellersCommonName || item.issuerCommonName || item.sellerCommonName,
                price: item.price || '',
                totalAmount:  item.totalPrice || (item.price ? item.price * getItemQuantity(item) : ''),
                status: item.status || '1',
                reference: item.transferNumber || item.orderId || item.redemption_id,
                quantity: getItemQuantity(item),
                assetName:asset?.name || "null",
                assetDescription:asset?.description || 'null',
                assetImage:getImage(asset),
                category:asset?.category || 'null',
                assetPrice: item?.assetPrice,
                assetAddress: asset?.address,
                assetOriginAddress: asset?.originAddress,
                assetContractName: asset?.contract_name,
                quantityIsDecimal: asset?.data.quantityIsDecimal
            }});

            res.status(200).json({ success: true, message: "Fetched Transactions successfully", data: newData })
            return next()
        } catch (e) {
            return next(e)
        }
    }

}

export default TransactionController

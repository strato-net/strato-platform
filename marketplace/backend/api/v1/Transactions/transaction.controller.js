
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

            const queryData = { creator: process.env.SELLER, offset:0 }
            const { inventories } = await dapp.getAllInventories({ ...queryData })
            const assetsAddressArr = inventories.map(item=>item.address); 
            const inventoriesWithImageUrl = inventories;

            let transactionQuery = {
                limit: limit,
                offset: offset,
                order: 'createdDate.desc',
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
                order: 'transferDate.desc',
                id: search
            }
            if(startDate && endDate){
                transactionQuery['range'] = [`createdDate,${startDate},${endDate}`]
                redemptionQuery['range'] = [`redemptionDate,${startDate},${endDate}`]
                TransferQuery['range'] = [`transferDate,${startDate},${endDate}`]
            }

            let orderData = [], itemTransferData = [], count=0;
            let data = []
            let redemptionData = [];
            if (type === 'Order' || !type) {
                orderData = await dapp.getSaleOrders({ ...transactionQuery, assetAddress: assetsAddressArr });
                count = count + orderData.count;
                data = [...data, ...orderData.data];                
            }
            if (type === 'Transfer' || !type) {
                for(let i=0; i<assetsAddressArr.length; i= i + 100){
                    const currentAddresses = assetsAddressArr.slice(i, i + 100);
                const itemTransfers = await dapp.getAllItemTransferEvents({...TransferQuery, assetAddress: currentAddresses});
                itemTransferData.push(...itemTransfers?.transfers)
                }
                count = count + itemTransferData.length;
                data = [...data, ...itemTransferData]
            }
            if (type === 'Redemption' || !type) {
                for(let i=0; i<assetsAddressArr.length; i= i + 100){
                    const currentAddresses = assetsAddressArr.slice(i, i + 100);
                const allRedemptions = await dapp.getAllRedemptionRequests({...redemptionQuery, assetAddress: currentAddresses})
                
                let redemptions = [...allRedemptions.data];
                redemptionData.push(...redemptions)
                redemptions = redemptions.filter((value, index, self) =>
                    index === self.findIndex((t) => (
                        t.redemption_id === value.redemption_id
                    ))
                );
                };

                redemptionData = redemptionData.filter((value, index, self) =>
                    index === self.findIndex((t) => (
                        t.redemption_id === value.redemption_id
                    ))
                );
                count = count + Number(redemptionData?.length);
                data = [...data, ...redemptionData]
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

            let sortData = data.sort((a, b) => ( b?.transferDate || b?.redemptionDate || b?.createdDate) - ( a?.transferDate || a?.redemptionDate || a?.createdDate));
            sortData = sortData.filter(item=>assetsAddressArr.includes(item?.assetAddress || item?.assetAddresses[0]))  
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

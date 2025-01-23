const getItemQuantity = (item) => {
  if (item.quantity) {
    return item.quantity;
  } else if (item.quantities?.length) {
    return item.quantities[0];
  } else if (item['BlockApps-Mercata-Order-quantities']?.length) {
    return item['BlockApps-Mercata-Order-quantities'][0]?.value;
  } else {
    return '';
  }
};
class TransactionController {
  static async getAllTransactions(req, res, next) {
    try {
      const { dapp, params, query } = req;
      const {
        limit = '2000',
        offset = '0',
        order,
        search = '',
        type,
        user,
        userAddress,
        startDate,
        endDate,
      } = query;
      let transactionQuery = {
        limit: limit,
        offset: offset,
        order: 'createdDate.desc',
        or: `(sellersCommonName.eq.${user},purchasersCommonName.eq.${user})`,
        id: search,
      };

      const redemptionQuery = {
        limit: limit,
        offset: offset,
        order: 'DESC',
        search: search,
      };

      const TransferQuery = {
        limit: limit,
        offset: offset,
        or: `(oldOwnerCommonName.eq.${user},newOwnerCommonName.eq.${user})`,
        order: 'transferDate.desc',
        id: search,
      };

      const stakeQuery = {
        limit: limit,
        offset: offset,
        borrowerCommonName: user,
        userAddress: userAddress,
      };

      if (startDate && endDate) {
        transactionQuery['range'] = [`createdDate,${startDate},${endDate}`];
        redemptionQuery['range'] = [`redemptionDate,${startDate},${endDate}`];
        TransferQuery['range'] = [`transferDate,${startDate},${endDate}`];
      }

      let outgoingRedemptions,
        incomingRedemptions,
        count = 0;
      let data = [];
      if (type === 'Order' || !type) {
        const { orderData, total } = await dapp.getSaleOrders({
          ...transactionQuery,
        });
        data = [...data, ...orderData];
        count = count + total;
      }
      if (type === 'Transfer' || !type) {
        const { transfers, total } = await dapp.getAllItemTransferEvents(
          TransferQuery
        );
        data = [...data, ...transfers];
        count = count + total;
      }
      if (type === 'Stake' || !type) {
        const { stakeTransactions, total } = await dapp.getStakeTransactions(
          stakeQuery
        );
        data = [...data, ...stakeTransactions];
        count = count + total;
      }
      if (type === 'Unstake' || !type) {
        const { unstakeTransactions, total } =
          await dapp.getUnstakeTransactions(stakeQuery);
        data = [...data, ...unstakeTransactions];
        count = count + total;
      }
      if (type === 'Redemption' || !type) {
        outgoingRedemptions = await dapp.getOutgoingRedemptionRequests(
          redemptionQuery
        );
        incomingRedemptions = await dapp.getIncomingRedemptionRequests(
          redemptionQuery
        );
        let redemptions = [
          ...outgoingRedemptions?.data,
          ...incomingRedemptions?.data,
        ];
        const total =
          Number(outgoingRedemptions?.count) +
          Number(incomingRedemptions?.count);
        count = count + total;
        redemptions = redemptions.filter(
          (value, index, self) =>
            index ===
            self.findIndex((t) => t.redemption_id === value.redemption_id)
        );
        data = [...data, ...redemptions];
      }
      let assetAddress = data.filter((item) => {
        if (item.assetAddress) {
          return item.assetAddress;
        } else if (item.assetAddresses) {
          return item.assetAddresses[0];
        }
      });

      assetAddress = assetAddress.map(
        (item) => item.assetAddress || item.assetAddresses[0]
      );
      assetAddress = [...new Set(assetAddress)];

      const queryData = { address: assetAddress, limit: 2000, offset: 0 };
      const inventories = await dapp.getAllInventories({ ...queryData });
      const inventoriesWithImageUrl = inventories?.inventories;
      const sortData = data.sort(
        (a, b) =>
          (b?.transferDate || b?.redemptionDate || b?.createdDate) -
          (a?.transferDate || a?.redemptionDate || a?.createdDate)
      );
      const newData = sortData?.map((item) => {
        const asset = inventoriesWithImageUrl.find((assetItem) => {
          return (
            assetItem.address ===
            (item?.assetAddress || (item?.assetAddresses?.length ? item?.assetAddresses[0] : ''))
          );
        });

        const getImage = (assetItem) => {
          if (
            assetItem &&
            assetItem['BlockApps-Mercata-Asset-images']?.length
          ) {
            return assetItem['BlockApps-Mercata-Asset-images'][0].value;
          } else if (item.image) {
            return item.image;
          } else {
            return '';
          }
        };

        return {
          ...item,
          createdDate:
            item.transferDate || item.redemptionDate || item.createdDate,
          from:
            item.oldOwnerCommonName ||
            item.purchasersCommonName ||
            item.ownerCommonName ||
            asset?.ownerCommonName,
          to:
            item.newOwnerCommonName ||
            item.sellersCommonName ||
            item.issuerCommonName ||
            item.sellerCommonName ||
            item.borrowerCommonName,
          price: item.price || '',
          totalAmount:
            item.totalPrice ||
            (item.price ? item.price * getItemQuantity(item) : ''),
          status: item.status || '1',
          reference:
            item.transferNumber ||
            item.orderId ||
            item.redemption_id ||
            item.stakeId,
          quantity: getItemQuantity(item),
          assetName: asset?.name || 'null',
          assetDescription: asset?.description || 'null',
          assetImage: getImage(asset),
          category: asset?.category || 'null',
          assetPrice: item?.assetPrice || 0,
          assetAddress: asset?.address,
          assetOriginAddress: asset?.originAddress,
          assetContractName: asset?.contract_name,
        };
      });

      res.status(200).json({
        success: true,
        message: 'Fetched Transactions successfully',
        data: newData,
        count: count,
      });
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getGlobalTransactions(req, res, next) {
    try {
      const { dapp, params, query } = req;
      const {
        limit,
        offset = '0',
        order,
        search = '',
        type,
        user,
        startDate,
        endDate,
      } = query;
      let transactionQuery = {
        limit: limit,
        offset: offset,
        order: 'createdDate.desc',
        id: search,
      };

      const redemptionQuery = {
        limit: limit,
        offset: offset,
        order: 'DESC',
        search: search,
      };

      const TransferQuery = {
        limit: limit,
        offset: offset,
        order: 'transferDate.desc',
        id: search,
      };

      const stakeQuery = {
        limit: limit,
        offset: offset,
      };

      if (startDate && endDate) {
        transactionQuery['range'] = [`createdDate,${startDate},${endDate}`];
        redemptionQuery['range'] = [`redemptionDate,${startDate},${endDate}`];
        TransferQuery['range'] = [`transferDate,${startDate},${endDate}`];
      }

      let orderlist,
        itemTransfers,
        redemptions,
        count = 0;
      let data = [];
      if (type?.includes('Order')) {
        const { orderData, total } = await dapp.getSaleOrders({
          ...transactionQuery,
        });
        count = count + total;
        orderlist = orderData;
        data = [...data, ...orderlist];
      }
      if (type?.includes('Transfer')) {
        const { transfers, total } = await dapp.getAllItemTransferEvents(
          TransferQuery
        );
        count = count + total;
        data = [...data, ...transfers];
      }
      if (type?.includes('Stake')) {
        const { stakeTransactions, total } = await dapp.getStakeTransactions(
          stakeQuery
        );
        count = count + total;
        data = [...data, ...stakeTransactions];
      }
      if (type?.includes('Unstake')) {
        const { unstakeTransactions, total } =
          await dapp.getUnstakeTransactions(stakeQuery);
        count = count + total;
        data = [...data, ...unstakeTransactions];
      }
      if (type?.includes('Redemption')) {
        redemptions = await dapp.getAllRedemptionRequests(redemptionQuery);
        count = count + Number(redemptions.count);
        redemptions = redemptions?.data.filter(
          (value, index, self) =>
            index ===
            self.findIndex((t) => t.redemption_id === value.redemption_id)
        );
        data = [...data, ...redemptions];
      }

      let assetAddress = data.filter((item) => {
        if (item.assetAddress) {
          return item.assetAddress;
        } else if (item.assetAddresses) {
          return item.assetAddresses[0];
        }
      });

      assetAddress = assetAddress.map(
        (item) => item.assetAddress || item.assetAddresses[0]
      );
      assetAddress = [...new Set(assetAddress)];

      const queryData = { address: assetAddress, limit: 2000, offset: 0 };
      const inventories = await dapp.getAllInventories({ ...queryData });
      const inventoriesWithImageUrl = inventories?.inventories;
      const sortData = data.sort(
        (a, b) =>
          (b?.transferDate || b?.redemptionDate || b?.createdDate) -
          (a?.transferDate || a?.redemptionDate || a?.createdDate)
      );
      const newData = sortData.map((item) => {
        const asset = inventoriesWithImageUrl.find((assetItem) => {
          return (
            assetItem.address ===
            (item?.assetAddress || item?.assetAddresses[0])
          );
        });

        const getImage = (assetItem) => {
          if (
            assetItem &&
            assetItem['BlockApps-Mercata-Asset-images']?.length
          ) {
            return assetItem['BlockApps-Mercata-Asset-images'][0].value;
          } else if (item.image) {
            return item.image;
          } else {
            return '';
          }
        };

        return {
          ...item,
          createdDate:
            item.transferDate || item.redemptionDate || item.createdDate,
          from:
            item.oldOwnerCommonName ||
            item.purchasersCommonName ||
            item.ownerCommonName ||
            asset?.ownerCommonName,
          to:
            item.newOwnerCommonName ||
            item.sellersCommonName ||
            item.issuerCommonName ||
            item.sellerCommonName ||
            item.borrowerCommonName,
          price: item.price || '',
          totalAmount:
            item.totalPrice ||
            (item.price ? item.price * getItemQuantity(item) : ''),
          status: item.status || '1',
          reference:
            item.transferNumber ||
            item.orderId ||
            item.redemption_id ||
            item.stakeId,
          quantity: getItemQuantity(item),
          assetName: asset?.name || 'null',
          assetDescription: asset?.description || 'null',
          assetImage: getImage(asset),
          category: asset?.category || 'null',
          assetPrice: item?.assetPrice || 0,
          assetAddress: asset?.address,
          assetOriginAddress: asset?.originAddress,
          assetContractName: asset?.contract_name,
        };
      });

      res.status(200).json({
        success: true,
        message: 'Fetched Transactions successfully',
        data: newData,
        count,
      });
      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default TransactionController;

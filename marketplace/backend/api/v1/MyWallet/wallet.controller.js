import { rest } from "blockapps-rest";

class WalletController {
  static async getWalletSummary(req, res, next) {
    try {
      const { dapp, address: userAddress } = req;
      const summary = await dapp.getWalletSummary({ userAddress });
      return rest.response.status200(res, summary);
    } catch (e) {
      return next(e);
    }
  }

  static async getWalletAssets(req, res, next) {
    try {
      const { dapp, query } = req;
      const { gtField, gtValue, address, ...restQuery } = query;

      const inventories = await dapp.getWalletAssets({
        userProfileGtField: gtField,
        userProfileGtValue: gtValue,
        address,
        ...restQuery,
      });
      const sortedInventories = inventories?.inventoryResults.sort((a, b) => {
        if (a.saleDate && b.saleDate) {
          return b.saleDate.localeCompare(a.saleDate);
        }
        return a.saleDate ? -1 : 1;
      });

      rest.response.status200(res, {
        inventoriesWithImageUrl: sortedInventories,
        count: sortedInventories.length,
      });

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getStratsBalance(req, res, next) {
    try {
      const { dapp, address: userAddress } = req;
      const asset = "STRATS";
      const gainLoss = "---";
      let stratsBalance = 0;
      let unitPrice = 0.01;

      const quantity = await dapp.getStratsBalance({
        userAddress: userAddress,
      });

      function roundToDecimalPlaces(number, decimalPlaces) {
        const factor = Math.pow(10, decimalPlaces);
        return Math.round(number * factor) / factor;
      }

      // Use roundToDecimalPlaces instead of toFixed
      const value = roundToDecimalPlaces(unitPrice * quantity, 2);

      let data = { asset, unitPrice, quantity, gainLoss, value };

      return rest.response.status200(res, data);
    } catch (e) {
      return next(e);
    }
  }
}

export default WalletController;

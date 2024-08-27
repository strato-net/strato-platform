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
      const { dapp, address: userAddress } = req;
      const assets = await dapp.getWalletAssets({ userAddress });
      return rest.response.status200(res, assets);
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

      let value = (unitPrice * stratsBalance).toFixed(2);

      let data = { asset, unitPrice, quantity, gainLoss, value };

      return rest.response.status200(res, data);
    } catch (e) {
      return next(e);
    }
  }
}

export default WalletController;

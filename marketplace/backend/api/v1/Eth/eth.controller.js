import { rest } from 'blockapps-rest';
import EthJs from '../../../dapp/items/eth';

class EthController {
//   static async getETHSTBalance(req, res, next) {
//     try {
//       const { dapp, address: userAddress } = req;
//       let stratsBalance = 0;

//       stratsBalance = await dapp.getStratsBalance({ userAddress: userAddress });

//       return rest.response.status200(res, stratsBalance);
//     } catch (e) {
//       return next(e);
//     }
//   }

  static async getETHSTAddress(req, res, next) {
    try {
      const address = await EthJs.getETHSTAddress();

      return rest.response.status200(res, address);
    } catch (e) {
      return next(e);
    }
  }

}

export default EthController;

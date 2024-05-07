import { rest } from 'blockapps-rest';
import sendEmail from '../../../helpers/email';

class SellerStatusController {
  static async requestReview(req, res, next){
    try {
      const {dapp, body} = req;
      const user = await dapp.requestReview( {commonName} )
      const {emailAddr, commonName} = body;
      const contents = `The user <b>${commonName}</b> is requesting to be an authorized seller on Strato Mercata. You may get in contact with them by reaching out at ${emailAddr}. If you decide to authorize them, you may do so at the /admin endpoint on the marketplace.`
      // todo: remember to change to address after done testing
      await sendEmail('aya_abdelgawad@blockapps.net', commonName + ' Requesting Seller Status', contents);
      rest.response.status200(res, user);
      return next();
    } catch (e) {
      next(e);
    }
  }

  static async authorizeSeller(req, res, next){
    try {
      const {dapp, body} = req;
      let user = await dapp.authorizeSeller(body);
      rest.response.status200(res, user);
      next();
    } catch (e) {
      next(e);
    }
  }

  static async deauthorizeSeller(req, res, next){
    try {
      const {dapp, body} = req;
      let user = await dapp.deauthorizeSeller(body); // i don't think this returns a user?
      rest.response.status200(res, user);
      next();
    } catch (e) {
      next(e);
    }
  }
}

export default SellerStatusController;
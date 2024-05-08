import { rest } from 'blockapps-rest';
import sendEmail from '../../../helpers/email';

class SellerStatusController {
  static async requestReview(req, res, next){
    try {
      const {dapp, body} = req;
      await dapp.requestReview(body);
      const {emailAddr, commonName} = body;
      const contents = `The user <b>${commonName}</b> is requesting to be an authorized seller on Strato Mercata. You may get in contact with them by reaching out at ${emailAddr}. If you decide to authorize them, you may do so at the /admin endpoint on the marketplace.`
      // todo: remember to change to address after done testing
      await sendEmail('aya_abdelgawad@blockapps.net', commonName + ' Requesting Seller Status', contents);
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async authorizeSeller(req, res, next){
    try {
      const {dapp, body} = req;
      await dapp.authorizeSeller(body);
      rest.response.status200(res);
      return next(); //do i need if i already do status200 above?
    } catch (e) {
      return next(e);
    }
  }

  static async deauthorizeSeller(req, res, next){
    try {
      const {dapp, body} = req;
      await dapp.deauthorizeSeller(body);
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default SellerStatusController;
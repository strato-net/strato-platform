import RestStatus from 'http-status-codes';
import { rest } from 'blockapps-rest';
import config from '../../../load.config';
import sendEmail from '../../../helpers/email';

class SellerStatusController {
  static async requestReview(req, res, next){
    try {
      const {dapp, body} = req;
      const {emailAddr, commonName} = body;
      try {
        const contents = `The user <b>${commonName}</b> is requesting to be an authorized seller on Strato Mercata. You may get in contact with them by reaching out at ${emailAddr}. You may grant or deny seller authorization at the admin dashboad: ${config.serverHost}/admin.`
        await sendEmail('sales@blockapps.net', commonName + ' Requesting Seller Status', contents);
      } catch {
        throw new rest.RestError(RestStatus.BAD_GATEWAY,
          "Unable to send request; notify sales@blockapps.net for help"
        );
      }
      await dapp.requestReview(body);
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
      return next();
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
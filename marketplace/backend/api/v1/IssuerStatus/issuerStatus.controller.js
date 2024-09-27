import RestStatus from 'http-status-codes';
import { rest } from 'blockapps-rest';
import config from '../../../load.config';
import sendEmail from '../../../helpers/email';

class IssuerStatusController {
  static async requestReview(req, res, next){
    try {
      const {dapp, body} = req;
      const {emailAddr, commonName} = body;
      try {
        const contents = 'The user <b>'+commonName+'</b> is requesting to be an authorized issuer on Strato Mercata. You may get in contact with them by reaching out at '+emailAddr+'. You may grant or deny issuer authorization at the admin dashboad: '+config.serverHost+'/admin.';
        await sendEmail('sales@blockapps.net', commonName + ' Requesting Issuer Status', contents);
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

  static async authorizeIssuer(req, res, next){
    try {
      const {dapp, body} = req;
      await dapp.authorizeIssuer(body);
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async deauthorizeIssuer(req, res, next){
    try {
      const {dapp, body} = req;
      await dapp.deauthorizeIssuer(body);
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async setIsAdmin(req, res, next){
    try {
      const {dapp, body} = req;
      await dapp.setIsAdmin(body);
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default IssuerStatusController;
import RestStatus from 'http-status-codes';
import { rest } from 'blockapps-rest';
import config from '../../../load.config';
import sendEmail from '../../../helpers/email';
import { searchAllWithQueryArgs } from '../../../helpers/utils';
import constants from '../../../helpers/constants';
const options = { config, cacheNonce: true };

class IssuerStatusController {
  static async requestReview(req, res, next) {
    try {
      const { dapp, body, accessToken } = req;
      const { emailAddr, commonName } = body;

      try {
        const adminSearchOptions = { isAdmin: true };
        const admins = await searchAllWithQueryArgs(
          constants.userContractName,
          adminSearchOptions,
          options,
          accessToken
        );
        const adminUsernames = admins.map((a) => a.commonName);
        const contents = `
        <p>The user <b>${commonName}</b> is requesting to be an authorized issuer on Strato Mercata.</p> 
        <p>You may get in contact with them by reaching out at ${emailAddr}.</p>
        <p>You may grant or deny issuer authorization at the admin dashboard: ${config.serverHost}/admin.</p>
      `;
        await sendEmail(
          adminUsernames,
          commonName + ' Requesting Issuer Status',
          contents
        );
      } catch {
        throw new rest.RestError(
          RestStatus.BAD_GATEWAY,
          'Unable to send request; notify sales@blockapps.net for help'
        );
      }
      await dapp.requestReview(body);
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async authorizeIssuer(req, res, next) {
    try {
      const { dapp, body } = req;
      await dapp.authorizeIssuer(body);
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async deauthorizeIssuer(req, res, next) {
    try {
      const { dapp, body } = req;
      await dapp.deauthorizeIssuer(body);
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async setIsAdmin(req, res, next) {
    try {
      const { dapp, body } = req;
      await dapp.setIsAdmin(body);
      rest.response.status200(res);
      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default IssuerStatusController;

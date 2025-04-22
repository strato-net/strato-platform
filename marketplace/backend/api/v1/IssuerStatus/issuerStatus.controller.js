import RestStatus from 'http-status-codes';
import { rest } from 'blockapps-rest';
import config from '../../../load.config';
import sendEmail from '../../../helpers/email';
import { searchAllWithQueryArgs } from '../../../helpers/utils';
import constants from '../../../helpers/constants';
const options = { config, cacheNonce: true };

/**
 * Controller for handling IssuerStatus-related API endpoints.
 * Provides functionality for managing issuer status and admin privileges.
 */
class IssuerStatusController {
  /**
   * Submits a request for an issuer to be reviewed and authorized.
   * Sends an email notification to all admin users about the request.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.emailAddr - Email address of the user requesting issuer status
   * @param {string} req.body.commonName - Common name of the user requesting issuer status
   * @param {Object} req.accessToken - Access token for authentication
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {rest.RestError} - If there is an error submitting the review request or sending notifications
   */
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

  /**
   * Grants issuer authorization to a user.
   * This endpoint requires admin privileges.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.address - Blockchain address of the user to be authorized as an issuer
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error authorizing the issuer
   */
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

  /**
   * Revokes issuer authorization from a user.
   * This endpoint requires admin privileges.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.address - Blockchain address of the user to be deauthorized as an issuer
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error deauthorizing the issuer
   */
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

  /**
   * Sets or removes admin privileges for a user.
   * This endpoint requires admin privileges.
   * 
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance for blockchain interaction
   * @param {Object} req.body - Request body
   * @param {string} req.body.address - Blockchain address of the user to set admin status
   * @param {boolean} req.body.isAdmin - Whether to grant (true) or revoke (false) admin privileges
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - A promise that resolves when the response has been sent
   * @throws {Error} - If there is an error setting admin status
   */
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

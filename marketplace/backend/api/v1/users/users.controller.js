/**
 * @fileoverview Users Controller Module
 * @description Controller for managing user operations in the STRATO Mercata Marketplace.
 * This controller handles retrieving user information including profiles, certificates, and
 * user lists. It interacts with blockchain data to obtain user certificates and integrates
 * with token-based authentication for additional user details.
 */

import { rest } from 'blockapps-rest';
import config from '../../../load.config';
import { pollingHelper, searchAllWithQueryArgs } from '../../../helpers/utils';
import constants, { ISSUER_STATUS } from '../../../helpers/constants';

const options = { config, cacheNonce: true };

/**
 * @class UsersController
 * @description Controller class for handling user-related operations
 */
class UsersController {
  /**
   * @method me
   * @description Retrieves the profile of the authenticated user with details from their token and blockchain certificate
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Loaded STRATO dapp instance
   * @param {Object} req.accessToken - User's access token
   * @param {Object} req.decodedToken - Decoded JWT token with user information
   * @param {string} req.address - User's blockchain address
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns user profile via Express response, combining blockchain data and token information
   * @throws {Error} - Passes errors to error handling middleware
   */
  static async me(req, res, next) {
    try {
      const { dapp, accessToken, decodedToken, address: userAddress } = req;
      const username = decodedToken.preferred_username;
      let user = null;
      if (Object.hasOwn(dapp, 'hasCert')) user = dapp.hasCert;
      if (user === null || user === undefined) {
        user = await pollingHelper(dapp.getCertificate, [{ userAddress }]);
        // user = await dapp.getCertificate({ userAddress })
        if (user === null || user === undefined)
          console.log('user not found in after multiple attempts');
      }
      console.debug('me USER ', user);
      if (!user || Object.keys(user).length == 0) {
        rest.response.status400(res, { username });
      } else {
        const walletSearchOptions = {
          commonName: user.commonName,
          notEqualsField: 'issuerStatus',
          notEqualsValue: 'null',
          sort: '-block_timestamp',
          limit: 1,
        };
        const walletResp = await searchAllWithQueryArgs(
          constants.userContractName,
          walletSearchOptions,
          options,
          accessToken
        );

        rest.response.status200(res, {
          ...user,
          email: decodedToken.email,
          preferred_username: decodedToken.preferred_username,
          issuerStatus: walletResp[0]
            ? walletResp[0].issuerStatus
            : ISSUER_STATUS.UNAUTHORIZED,
          isAdmin: walletResp[0] ? walletResp[0].isAdmin : false,
        });
      }
      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * @method get
   * @description Retrieves a user's certificate by their blockchain address
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Loaded STRATO dapp instance
   * @param {Object} req.query - Query parameters
   * @param {string} req.query.address - Blockchain address of the user to retrieve
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns user certificate via Express response
   * @throws {Error} - Passes errors to error handling middleware
   */
  static async get(req, res, next) {
    try {
      const { dapp, query } = req;
      const { address } = query;
      const user = await dapp.getCertificate({
        userAddress: address,
      });

      if (!user || Object.keys(user).length == 0) {
        rest.response.status(404, res, { address });
      } else {
        rest.response.status200(res, user);
      }
      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * @method getAll
   * @description Retrieves certificates for all users with optional filtering
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Loaded STRATO dapp instance
   * @param {Object} req.query - Query parameters for filtering
   * @param {number} [req.query.limit] - Maximum number of users to return
   * @param {number} [req.query.offset] - Number of users to skip for pagination
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns list of user certificates via Express response
   * @throws {Error} - Passes errors to error handling middleware
   */
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const users = await dapp.getCertificates(query);
      rest.response.status200(res, users);
      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default UsersController;

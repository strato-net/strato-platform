/**
 * @fileoverview User Activity Controller Module
 * @description Controller for managing user activity operations in the STRATO Mercata Marketplace.
 * This controller handles retrieving user activities including purchases, sales, and transfers.
 * Activities can be filtered by various parameters defined in the query string.
 */

import { rest } from 'blockapps-rest';

/**
 * @class UserActivityController
 * @description Controller class for handling user activity-related operations
 */
class UserActivityController {
  /**
   * @method getAll
   * @description Retrieves recent user activity including purchases, sales, and transfers
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Loaded STRATO dapp instance
   * @param {Object} req.query - Query parameters for filtering activities
   * @param {string} [req.query.sellersCommonName] - Filter by seller's common name
   * @param {string} [req.query.purchasersCommonName] - Filter by purchaser's common name
   * @param {string} [req.query.newOwnerCommonName] - Filter by new owner's common name
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns user activity data via Express response
   * @throws {Error} - Passes errors to error handling middleware
   */
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;
      const userActivity = await dapp.getAllUserActivity({ ...query });
      rest.response.status200(res, userActivity);

      return next();
    } catch (e) {
      return next(e);
    }
  }
}

export default UserActivityController;

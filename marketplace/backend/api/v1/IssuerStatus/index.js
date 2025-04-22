import express from 'express';
import { IssuerStatus } from '../endpoints';
import IssuerStatusController from './issuerStatus.controller';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

/**
 * Express router for IssuerStatus-related API endpoints.
 * Sets up routes for managing issuer status and admin privileges.
 */
const router = express.Router();

/**
 * POST /api/v1/issuerstatus/requestReview
 * Route to submit a request for an issuer to be reviewed and authorized.
 * Sends an email notification to all admin users about the request.
 * Requires authentication and loads the dapp instance before passing to the controller.
 * 
 * @param {Object} body - Request body
 * @param {string} body.emailAddr - Email address of the user requesting issuer status
 * @param {string} body.commonName - Common name of the user requesting issuer status
 * @returns {Object} Success response object
 * @throws {Error} 400 - Invalid input data
 * @throws {Error} 401 - User is not authenticated
 * @throws {Error} 502 - Unable to send email notification
 */
router.post(
  IssuerStatus.requestReview,
  authHandler.authorizeRequest(),
  loadDapp,
  IssuerStatusController.requestReview
);

/**
 * POST /api/v1/issuerstatus/authorizeIssuer
 * Route to grant issuer authorization to a user.
 * Requires authentication (with admin privileges) and loads the dapp instance.
 * 
 * @param {Object} body - Request body
 * @param {string} body.address - Blockchain address of the user to be authorized as an issuer
 * @returns {Object} Success response object
 * @throws {Error} 400 - Invalid input data
 * @throws {Error} 401 - User is not authenticated
 * @throws {Error} 403 - User does not have admin privileges
 */
router.post(
  IssuerStatus.authorizeIssuer,
  authHandler.authorizeRequest(),
  loadDapp,
  IssuerStatusController.authorizeIssuer
);

/**
 * POST /api/v1/issuerstatus/deauthorizeIssuer
 * Route to revoke issuer authorization from a user.
 * Requires authentication (with admin privileges) and loads the dapp instance.
 * 
 * @param {Object} body - Request body
 * @param {string} body.address - Blockchain address of the user to be deauthorized as an issuer
 * @returns {Object} Success response object
 * @throws {Error} 400 - Invalid input data
 * @throws {Error} 401 - User is not authenticated
 * @throws {Error} 403 - User does not have admin privileges
 */
router.post(
  IssuerStatus.deauthorizeIssuer,
  authHandler.authorizeRequest(),
  loadDapp,
  IssuerStatusController.deauthorizeIssuer
);

/**
 * POST /api/v1/issuerstatus/admin
 * Route to set or remove admin privileges for a user.
 * Requires authentication (with admin privileges) and loads the dapp instance.
 * 
 * @param {Object} body - Request body
 * @param {string} body.address - Blockchain address of the user to set admin status
 * @param {boolean} body.isAdmin - Whether to grant (true) or revoke (false) admin privileges
 * @returns {Object} Success response object
 * @throws {Error} 400 - Invalid input data
 * @throws {Error} 401 - User is not authenticated
 * @throws {Error} 403 - User does not have admin privileges
 */
router.post(
  IssuerStatus.admin,
  authHandler.authorizeRequest(),
  loadDapp,
  IssuerStatusController.setIsAdmin
);

export default router;

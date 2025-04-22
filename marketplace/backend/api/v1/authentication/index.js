/**
 * @module Authentication
 * @description API routes for authentication-related endpoints
 */
import express from 'express';
import AuthenticationController from './authentication.controller';
import authHandler from '../../middleware/authHandler';

const router = express.Router();

/**
 * GET /api/v1/authentication/callback
 * @description Handles the OAuth callback after user authentication. This endpoint processes the authorization code, 
 * retrieves access and refresh tokens, validates user certificates, and sets authentication cookies.
 * @param {string} code - The authorization code received from the OAuth provider
 * @returns {undefined} - Redirects to the home page or return URL
 * @security No authentication required
 */
router.get('/callback', AuthenticationController.callback);

/**
 * GET /api/v1/authentication/logout
 * @description Logs out the currently authenticated user by clearing authentication cookies 
 * and providing a URL for the OAuth provider's logout endpoint.
 * @returns {Object} 200 - Successful logout with logoutUrl
 * @returns {string} logoutUrl - URL to redirect to for completing the OAuth logout process
 * @security bearerToken, oauth2 (openid, profile)
 */
router.get(
  '/logout',
  authHandler.authorizeRequest(),
  AuthenticationController.logout
);

export default router;

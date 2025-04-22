/**
 * @module CarbonOffset
 * @description API routes for CarbonOffset-related endpoints
 */
import express from 'express';
import CarbonOffsetController from './carbonOffset.controller';
import { CarbonOffset } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * GET /api/v1/carbonOffset
 * @description Retrieves a list of all carbon offsets in the system
 * @security bearerToken, oauth2 (openid, profile)
 * @param {number} [limit] - Maximum number of carbon offsets to return
 * @param {number} [offset] - Number of carbon offsets to skip
 * @returns {Array} 200 - List of carbon offsets
 * @returns {Object} 401 - Unauthorized - User is not authenticated
 * @returns {Object} 403 - Forbidden - User does not have permission to access carbon offsets
 */
router.get(
  CarbonOffset.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  CarbonOffsetController.getAll
);

/**
 * POST /api/v1/carbonOffset
 * @description Creates a new carbon offset in the system
 * @security bearerToken, oauth2 (openid, profile)
 * @param {Object} requestBody - Carbon offset creation payload
 * @param {Object} requestBody.itemArgs - Carbon offset item arguments
 * @param {string} requestBody.itemArgs.name - Name of the carbon offset
 * @param {string} requestBody.itemArgs.description - Detailed description of the carbon offset
 * @param {number} requestBody.itemArgs.quantity - Quantity of carbon credits represented by this offset (minimum: 1)
 * @param {number} requestBody.itemArgs.decimals - Number of decimal places for the carbon offset (0-18)
 * @param {string[]} requestBody.itemArgs.images - Array of image URLs for the carbon offset
 * @param {string[]} requestBody.itemArgs.files - Array of file URLs for the carbon offset
 * @param {string[]} requestBody.itemArgs.fileNames - Array of file names for the carbon offset
 * @param {string} requestBody.itemArgs.redemptionService - Service used for redeeming the carbon offset
 * @returns {Object} 200 - Carbon offset created successfully
 * @returns {Object} 400 - Bad Request - Invalid input data
 * @returns {Object} 401 - Unauthorized - User is not authenticated
 * @returns {Object} 403 - Forbidden - User does not have permission to create carbon offsets
 */
router.post(
  CarbonOffset.create,
  authHandler.authorizeRequest(),
  loadDapp,
  CarbonOffsetController.create
);

export default router;

/**
 * @module Art
 * @description API routes for Art-related endpoints
 */
import express from 'express';
import ArtController from './art.controller';
import { Art } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * GET /api/v1/art
 * @description Retrieve all art items
 * @security bearerToken, oauth2
 * @param {number} [limit] - Maximum number of art items to return
 * @param {number} [offset] - Number of art items to skip
 * @returns {Array} 200 - List of art items
 * @returns {Object} 401 - Unauthorized - User is not authenticated
 * @returns {Object} 403 - Forbidden - User does not have permission to access art items
 */
router.get(
  Art.getAll, // Assuming this is the correct endpoint for getting all arts
  authHandler.authorizeRequest(true),
  loadDapp,
  ArtController.getAll
);

/**
 * POST /api/v1/art
 * @description Create a new art item
 * @security bearerToken, oauth2
 * @param {Object} requestBody - Art creation payload
 * @param {Object} requestBody.itemArgs - Art item arguments
 * @param {string} [requestBody.itemArgs.serialNumber] - Optional serial number for the art item
 * @param {string} requestBody.itemArgs.name - Name of the art item
 * @param {string} requestBody.itemArgs.description - Detailed description of the art item
 * @param {number} requestBody.itemArgs.decimals - Number of decimal places (0-18)
 * @param {string} requestBody.itemArgs.artist - Name of the artist who created the art item
 * @param {string[]} requestBody.itemArgs.images - Array of image URLs for the art item
 * @param {string[]} requestBody.itemArgs.files - Array of file URLs for the art item
 * @param {string[]} requestBody.itemArgs.fileNames - Array of file names for the art item
 * @param {string} requestBody.itemArgs.redemptionService - Service used for redeeming the art item
 * @returns {Object} 200 - Art item created successfully
 * @returns {Object} 400 - Bad Request - Invalid input data
 * @returns {Object} 401 - Unauthorized - User is not authenticated
 * @returns {Object} 403 - Forbidden - User does not have permission to create art items
 */
router.post(
  Art.create, // Assuming this is the correct endpoint for creating an art
  authHandler.authorizeRequest(),
  loadDapp,
  ArtController.create
);

export default router;

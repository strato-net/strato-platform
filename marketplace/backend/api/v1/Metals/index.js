import express from 'express';
import MetalsController from './metals.controller';
import { Metals } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

/**
 * Express router for handling metals-related API endpoints.
 * Provides routes for retrieving all metals and creating new metal assets.
 * All routes use the loadDapp middleware to access blockchain data.
 * Metals represent physically backed tokens for various types of metals (gold, silver, etc.).
 */
const router = express.Router();

/**
 * GET /api/v1/metals
 * Retrieves a list of all metals in the system.
 * Can be filtered by query parameters (limit, offset, owner).
 * Allows anonymous access (allowAnonAccess=true).
 */
router.get(
  Metals.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  MetalsController.getAll
);

/**
 * POST /api/v1/metals
 * Creates a new metal in the system.
 * Requires authentication (no allowAnonAccess).
 * Expects a request body with metal details according to OpenAPI spec.
 * Required fields include: name, description, source, quantity, decimals,
 * unitOfMeasurement, purity, images, files, fileNames, and redemptionService.
 */
router.post(
  Metals.create,
  authHandler.authorizeRequest(),
  loadDapp,
  MetalsController.create
);

export default router;

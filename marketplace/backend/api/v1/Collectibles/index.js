import express from 'express';
import CollectiblesController from './collectibles.controller';
import { Collectibles } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

/**
 * Express router for Collectibles-related API endpoints.
 * Sets up routes for retrieving and creating collectible items.
 */
const router = express.Router();

/**
 * GET /api/v1/collectibles
 * Route to retrieve all collectible items.
 * Uses optional auth (can be accessed by non-authenticated users)
 * and loads the dapp instance before passing to the controller.
 */
router.get(
  Collectibles.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  CollectiblesController.getAll
);

/**
 * POST /api/v1/collectibles
 * Route to create a new collectible item.
 * Requires authentication and loads the dapp instance
 * before passing to the controller.
 */
router.post(
  Collectibles.create,
  authHandler.authorizeRequest(),
  loadDapp,
  CollectiblesController.create
);

export default router;

import express from 'express';
import ClothingController from './clothing.controller';
import { Clothing } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

/**
 * Express router for Clothing-related API endpoints.
 * Sets up routes for retrieving and creating clothing items.
 */
const router = express.Router();

/**
 * GET /api/v1/clothing
 * Route to retrieve all clothing items.
 * Uses optional auth (can be accessed by non-authenticated users)
 * and loads the dapp instance before passing to the controller.
 */
router.get(
  Clothing.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  ClothingController.getAll
);

/**
 * POST /api/v1/clothing
 * Route to create a new clothing item.
 * Requires authentication and loads the dapp instance
 * before passing to the controller.
 */
router.post(
  Clothing.create,
  authHandler.authorizeRequest(),
  loadDapp,
  ClothingController.create
);

export default router;

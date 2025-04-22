import express from 'express';
import EscrowController from './escrow.controller';
import { Escrow } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

/**
 * Express router for Escrow-related API endpoints.
 * Sets up routes for retrieving escrow information and reward data.
 */
const router = express.Router();

/**
 * GET /api/v1/escrow/reward
 * Route to retrieve CATA token rewards for the authenticated user.
 * Uses optional auth (can be accessed by non-authenticated users)
 * and loads the dapp instance before passing to the controller.
 */
router.get(
  Escrow.getCataRewards,
  authHandler.authorizeRequest(true),
  loadDapp,
  EscrowController.getCataRewards
);

/**
 * GET /api/v1/escrow/:assetRootAddress
 * Route to retrieve escrow information for a specific asset by its root address.
 * Uses optional auth (can be accessed by non-authenticated users)
 * and loads the dapp instance before passing to the controller.
 */
router.get(
  Escrow.getEscrowForAsset,
  authHandler.authorizeRequest(true),
  loadDapp,
  EscrowController.getEscrowForAsset
);

export default router;

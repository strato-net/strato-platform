import express from 'express';
import MembershipController from './membership.controller';
import { Membership } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

/**
 * Express router for handling membership-related API endpoints.
 * Provides routes for retrieving all memberships and creating new memberships.
 * All routes use the loadDapp middleware to access blockchain data.
 */
const router = express.Router();

/**
 * GET /api/v1/membership
 * Retrieves a list of all memberships in the system.
 * Can be filtered by query parameters (limit, offset, owner).
 * Allows anonymous access (allowAnonAccess=true).
 */
router.get(
  Membership.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  MembershipController.getAll
);

/**
 * POST /api/v1/membership
 * Creates a new membership in the system.
 * Requires authentication (no allowAnonAccess).
 * Expects a request body with membership details according to OpenAPI spec.
 */
router.post(
  Membership.create,
  authHandler.authorizeRequest(),
  loadDapp,
  MembershipController.create
);

export default router;

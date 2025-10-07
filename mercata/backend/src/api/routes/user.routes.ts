import { Router } from "express";
import authHandler from "../middleware/authHandler";
import UserController from "../controllers/user.controller";

const router = Router();

/**
 * @openapi
 * /user/me:
 *   get:
 *     summary: Get current user information
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 */
router.get("/me", authHandler.authorizeRequest(), UserController.me);

/**
 * @openapi
 * /user/admin:
 *   get:
 *     summary: Get admin information
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 *   post:
 *     summary: Add new admin
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 *   delete:
 *     summary: Remove admin
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 */
router.get("/admin", authHandler.authorizeRequest(), UserController.admin);
router.post("/admin", authHandler.authorizeRequest(), UserController.addAdmin);
router.delete("/admin", authHandler.authorizeRequest(), UserController.removeAdmin);

/**
 * @openapi
 * /user/admin/contract/search:
 *   get:
 *     summary: Search contracts (admin)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 */
router.get("/admin/contract/search", authHandler.authorizeRequest(), UserController.contractSearch);

/**
 * @openapi
 * /user/admin/contract/details:
 *   get:
 *     summary: Get contract details (admin)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 */
router.get("/admin/contract/details", authHandler.authorizeRequest(), UserController.getContractDetails);

/**
 * @openapi
 * /user/admin/vote:
 *   post:
 *     summary: Cast vote on issue (admin)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: object }
 */
router.post("/admin/vote", authHandler.authorizeRequest(), UserController.castVoteOnIssue);

/**
 * @openapi
 * /user/admin/issues:
 *   get:
 *     summary: Get open issues (admin)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { type: object } }
 */
router.get("/admin/issues", authHandler.authorizeRequest(), UserController.getOpenIssues);

export default router;

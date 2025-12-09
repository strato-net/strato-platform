import { Router } from "express";
import authHandler from "../middleware/authHandler";
import UserController from "../controllers/user.controller";

const router = Router();

/**
 * @openapi
 * /user/me:
 *   get:
 *     summary: Retrieve profile information for the signed-in user
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Current user details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userAddress:
 *                   type: string
 *                 isAdmin:
 *                   type: boolean
 *                 userName:
 *                   type: string
 */
router.get("/me", authHandler.authorizeRequest(), UserController.me);

/**
 * @openapi
 * /user/admin:
 *   get:
 *     summary: List registered protocol administrators
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Administrator addresses
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 admins:
 *                   type: array
 *                   items:
 *                     type: string
 *   post:
 *     summary: Grant administrator access
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userAddress
 *             properties:
 *               userAddress:
 *                 type: string
 *                 description: Address to promote to admin
 *     responses:
 *       201:
 *         description: Admin grant transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *   delete:
 *     summary: Revoke administrator access
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userAddress
 *             properties:
 *               userAddress:
 *                 type: string
 *                 description: Address to revoke admin rights from
 *     responses:
 *       200:
 *         description: Admin revoke transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/admin", authHandler.authorizeRequest(), UserController.admin);
router.post("/admin", authHandler.authorizeRequest(), UserController.addAdmin);
router.delete("/admin", authHandler.authorizeRequest(), UserController.removeAdmin);

/**
 * @openapi
 * /user/admin/contract/search:
 *   get:
 *     summary: Search contracts by name or address
 *     tags: [Admin]
 *     parameters:
 *       - name: search
 *         in: query
 *         required: true
 *         description: Search term for contract discovery
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/admin/contract/search", authHandler.authorizeRequest(), UserController.contractSearch);

/**
 * @openapi
 * /user/admin/contract/details:
 *   get:
 *     summary: Retrieve contract metadata by address
 *     tags: [Admin]
 *     parameters:
 *       - name: address
 *         in: query
 *         required: true
 *         description: Contract address to inspect
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Contract detail payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/admin/contract/details", authHandler.authorizeRequest(), UserController.getContractDetails);

/**
 * @openapi
 * /user/admin/vote:
 *   post:
 *     summary: Cast an administrative vote
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - target
 *               - func
 *               - args
 *             properties:
 *               target:
 *                 type: string
 *                 description: Contract address to call
 *               func:
 *                 type: string
 *                 description: Function signature being approved
 *               args:
 *                 type: array
 *                 description: Encoded function arguments
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Vote transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/admin/vote", authHandler.authorizeRequest(), UserController.castVoteOnIssue);

/**
 * @openapi
 * /user/admin/vote/by-id:
 *   post:
 *     summary: Cast an administrative vote by issue ID
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - issueId
 *             properties:
 *               issueId:
 *                 type: string
 *                 description: The ID of the issue to vote on
 *     responses:
 *       200:
 *         description: Vote transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/admin/vote/by-id", authHandler.authorizeRequest(), UserController.castVoteOnIssueById);

/**
 * @openapi
 * /user/admin/dismiss:
 *   post:
 *     summary: Dismiss an issue (only works if proposer is the only voter)
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - issueId
 *             properties:
 *               issueId:
 *                 type: string
 *                 description: The ID of the issue to dismiss
 *     responses:
 *       200:
 *         description: Issue dismissed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/admin/dismiss", authHandler.authorizeRequest(), UserController.dismissIssue);

/**
 * @openapi
 * /user/admin/issues:
 *   get:
 *     summary: List open administrative issues
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Governance issue overview
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/admin/issues", authHandler.authorizeRequest(), UserController.getOpenIssues);

export default router;

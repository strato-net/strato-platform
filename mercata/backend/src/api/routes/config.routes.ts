import { Router } from "express";
import ConfigController from "../controllers/config.controller";

const router = Router();

/**
 * @openapi
 * /config:
 *   get:
 *     summary: Get application configuration
 *     tags: [Configuration]
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
router.get("/", ConfigController.getConfig);

export default router;

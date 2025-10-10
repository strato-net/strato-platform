import { Router } from "express";
import ConfigController from "../controllers/config.controller";

const router = Router();

/**
 * @openapi
 * /config:
 *   get:
 *     summary: Fetch public application configuration
 *     tags: [Configuration]
 *     responses:
 *       200:
 *         description: Configuration payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/", ConfigController.getConfig);

export default router;

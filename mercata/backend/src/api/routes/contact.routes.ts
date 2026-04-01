import { Router } from "express";
import ContactController from "../controllers/contact.controller";

const router = Router();

/**
 * @openapi
 * /contact:
 *   post:
 *     summary: Submit a physical metals inquiry
 *     tags: [Contact]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - message
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 200
 *               email:
 *                 type: string
 *                 format: email
 *               message:
 *                 type: string
 *                 maxLength: 5000
 *     responses:
 *       200:
 *         description: Message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 */
router.post("/", ContactController.submitMetalsInquiry);

export default router;

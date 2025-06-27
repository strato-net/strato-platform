import { Router } from "express";
import authHandler from "../middleware/authHandler";
import UserController from "../controllers/user.controller";

const router = Router();

router.get("/me", authHandler.authorizeRequest(), UserController.me);

router.get("/admin", authHandler.authorizeRequest(), UserController.admin);
router.post("/admin", authHandler.authorizeRequest(), UserController.addAdmin);
router.delete("/admin", authHandler.authorizeRequest(), UserController.removeAdmin);

export default router; 
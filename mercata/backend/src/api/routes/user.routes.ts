import { Router } from "express";
import authHandler from "../middleware/authHandler";
import UserController from "../controllers/user.controller";

const router = Router();

router.get("/me", authHandler.authorizeRequest(), UserController.me);

export default router; 
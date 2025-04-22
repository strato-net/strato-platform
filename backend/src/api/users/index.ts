import { Router } from "express";
import UsersController from "./users.controller";
import authHandler from "../../middleware/authHandler";

const router = Router();

router.get("/me", authHandler.authorizeRequest(true), UsersController.me);

export default router;

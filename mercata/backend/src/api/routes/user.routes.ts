import { Router } from "express";
import authHandler from "../middleware/authHandler";
import UserController from "../controllers/user.controller";

const router = Router();

router.get("/me", authHandler.authorizeRequest(), UserController.me);

router.get("/admin", authHandler.authorizeRequest(), UserController.admin);
router.post("/admin", authHandler.authorizeRequest(), UserController.addAdmin);
router.delete("/admin", authHandler.authorizeRequest(), UserController.removeAdmin);
router.get("/admin/contract/search", authHandler.authorizeRequest(), UserController.contractSearch);
router.get("/admin/contract/details", authHandler.authorizeRequest(), UserController.getContractDetails);
router.post("/admin/vote", authHandler.authorizeRequest(), UserController.castVoteOnIssue);
router.get("/admin/issues", authHandler.authorizeRequest(), UserController.getOpenIssues);

export default router; 
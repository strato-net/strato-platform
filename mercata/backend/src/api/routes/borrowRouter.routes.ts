import { Router } from "express";
import authHandler from "../middleware/authHandler";
import BorrowRouterController from "../controllers/borrowRouter.controller";

const router = Router();

router.post("/preview", authHandler.authorizeRequest(), BorrowRouterController.preview);
router.post("/execute", authHandler.authorizeRequest(), BorrowRouterController.execute);

export default router;


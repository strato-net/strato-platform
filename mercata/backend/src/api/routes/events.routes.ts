import { Router } from "express";
import authHandler from "../middleware/authHandler";
import EventsController from "../controllers/events.controller";

const router = Router();

// Get events with optional filters
router.get("/", authHandler.authorizeRequest(), EventsController.getEvents);

// Get contract information for filtering
router.get("/contracts", authHandler.authorizeRequest(), EventsController.getContractInfo);

export default router; 
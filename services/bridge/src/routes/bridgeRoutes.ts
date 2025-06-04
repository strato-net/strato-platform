import { Router } from 'express';
import BridgeController from '../controllers/bridgeController';

const router = Router();

router.post('/bridgeIn', BridgeController.bridgeIn);
router.post('/bridgeOut', BridgeController.bridgeOut);
router.post('/stratoTokenBalance', BridgeController.stratoTokenBalance);

export default router; 

import { Router } from 'express';
import BridgeController from '../controllers/bridgeController';

const router = Router();

router.post('/bridgeIn', BridgeController.bridgeIn);
router.post('/bridgeOut', BridgeController.bridgeOut);
router.post('/stratoTokenBalance', BridgeController.stratoTokenBalance);
router.get('/userDepositStatus/:status', BridgeController.userDepositStatus);
router.get('/userWithdrawalStatus/:status', BridgeController.userWithdrawalStatus);
router.get('/bridgeNetworkTokens/:type', BridgeController.getBridgeInNetworks);

export default router; 

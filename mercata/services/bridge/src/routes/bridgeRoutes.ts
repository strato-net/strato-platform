import { Router } from 'express';
import BridgeController from '../controllers/bridgeController';
import { verifyAccessToken } from '../middlewares';

const router = Router();

router.post('/bridgeIn',verifyAccessToken, BridgeController.bridgeIn);
router.post('/bridgeOut',verifyAccessToken, BridgeController.bridgeOut);
router.post('/stratoTokenBalance',verifyAccessToken, BridgeController.stratoTokenBalance);
router.get('/bridgeInTokens', BridgeController.getBridgeInTokens);
router.get('/bridgeOutTokens', BridgeController.getBridgeOutTokens);
router.get('/userDepositStatus/:status',verifyAccessToken, BridgeController.userDepositStatus);
router.get('/userWithdrawalStatus/:status',verifyAccessToken, BridgeController.userWithdrawalStatus);

export default router; 

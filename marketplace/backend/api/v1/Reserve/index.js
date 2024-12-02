import express from 'express';
import ReserveController from './reserve.controller';
import { Reserve } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Reserve.get,
  authHandler.authorizeRequest(true),
  loadDapp,
  ReserveController.get
);

router.get(
  Reserve.getAll,
  authHandler.authorizeRequest(true),
  loadDapp,
  ReserveController.getAll
);

router.get(
  Reserve.oraclePrice,
  authHandler.authorizeRequest(true),
  loadDapp,
  ReserveController.oraclePrice
);

router.post(
  Reserve.stake,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.stake
);

router.post(
  Reserve.unstake,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.unstake
);

router.post(
  Reserve.borrow,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.borrow
);

router.post(
  Reserve.repay,
  authHandler.authorizeRequest(),
  loadDapp,
  ReserveController.repay
);

export default router;

import express from 'express';
import InventoryController from './inventory.controller';
import { Inventory } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

router.get(
  Inventory.supportedTokens,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.getSupportedTokens
);

router.get(
  Inventory.get,
  authHandler.authorizeRequest(true),
  loadDapp,
  InventoryController.get
);

router.get(
  Inventory.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.getAll
);

router.get(
  Inventory.getAllUserInventories,
  authHandler.authorizeRequest(true),
  loadDapp,
  InventoryController.getAllUserInventories
);

router.get(
  Inventory.getOwnershipHistory,
  authHandler.authorizeRequest(true),
  loadDapp,
  InventoryController.getOwnershipHistory
);

router.post(
  Inventory.create,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.create
);

router.post(
  Inventory.list,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.list
);

router.post(
  Inventory.unlist,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.unlist
);

router.post(
  Inventory.resell,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.resell
);

router.post(
  Inventory.transfer,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.transfer
);

router.post(
  Inventory.bridge,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.bridge
);

router.get(
  Inventory.transferredItems,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.getAllItemTransferEvents
);

router.put(
  Inventory.update,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.update
);

router.put(
  Inventory.updateSale,
  authHandler.authorizeRequest(),
  loadDapp,
  InventoryController.updateSale
);

router.get(
  Inventory.getPriceHistory,
  authHandler.authorizeRequest(true),
  loadDapp,
  InventoryController.getPriceHistory
);

export default router;

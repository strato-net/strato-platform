import express from 'express';
import CustomerAddressController from './customerAddress.controller.js';

const router = express.Router();

router.get(
  '/address/:commonName', 
  CustomerAddressController.getAddresses
);

router.post(
  '/address', 
  CustomerAddressController.addAddress
);

router.get(
  '/address/id/:id',
  CustomerAddressController.getAddress
);

router.delete(
  '/address/id/:id', 
  CustomerAddressController.deleteAddress
);

export default router;
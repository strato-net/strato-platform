const express = require('express');
const CustomerAddressController = require('./customerAddress.controller');

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

module.exports = router;
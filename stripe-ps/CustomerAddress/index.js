const express = require('express');
const CustomerAddressController = require('./customerAddress.controller');

const router = express.Router();

router.get(
  '/address', 
  CustomerAddressController.getAddress
);

router.post(
  '/address', 
  CustomerAddressController.addAddress
);

module.exports = router;
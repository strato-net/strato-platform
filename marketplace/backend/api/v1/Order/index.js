/**
 * @fileoverview Order API routes configuration
 * 
 * This module defines all RESTful API routes for the Order service, which handles
 * order creation, payment processing, order retrieval, and management of shipping addresses.
 * Each route is protected by authentication middleware and uses the loadDapp middleware
 * to access blockchain data.
 * 
 * @module api/v1/Order
 */

import express from 'express';
import OrderController from './order.controller';
import { Order } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * @route GET /api/v1/order/exportOrders
 * @description Exports all orders in a format suitable for external systems
 * @access Private - Requires authentication
 */
router.get(
  Order.export,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.export
);

/**
 * @route GET /api/v1/order/:address
 * @description Retrieves a specific order by its blockchain address
 * @param {string} address - Blockchain address of the order to retrieve
 * @access Private - Requires authentication
 */
router.get(
  Order.get,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.get
);

/**
 * @route GET /api/v1/order
 * @description Retrieves a list of all sale orders with optional pagination
 * @param {number} [limit] - Maximum number of orders to return (query parameter)
 * @param {number} [offset] - Number of orders to skip (query parameter)
 * @access Private - Requires authentication
 */
router.get(
  Order.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.getAll
);

/**
 * @route POST /api/v1/order/payment
 * @description Processes a payment for an order and sends email confirmation if successful
 * @requestBody {Object} paymentService - Object containing address and serviceName
 * @requestBody {string} buyerOrganization - Organization of the buyer
 * @requestBody {Array} orderList - List of items being ordered with quantity, decimals, etc.
 * @requestBody {number} orderTotal - Total amount of the order
 * @requestBody {number} tax - Tax amount for the order
 * @requestBody {string} user - User email or identifier for notifications
 * @requestBody {Array} htmlContents - HTML content for email confirmation
 * @access Private - Requires authentication
 */
router.post(
  Order.payment,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.payment
);

/**
 * @route POST /api/v1/order/userAddress
 * @description Creates a new shipping address for a user
 * @requestBody {string} name - Name associated with the shipping address
 * @requestBody {string} zipcode - ZIP/Postal code
 * @requestBody {string} state - State or province
 * @requestBody {string} city - City
 * @requestBody {string} addressLine1 - First line of the address
 * @requestBody {string} [addressLine2] - Second line of the address (optional)
 * @requestBody {string} country - Country
 * @requestBody {string} [redemptionService] - Redemption service identifier (optional)
 * @access Private - Requires authentication
 */
router.post(
  Order.userAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.createUserAddress
);

/**
 * @route GET /api/v1/order/userAddress/:redemptionService/:shippingAddressId
 * @description Retrieves a specific shipping address by ID and redemption service
 * @param {string} redemptionService - Identifier for the redemption service
 * @param {string} shippingAddressId - ID of the shipping address to retrieve
 * @access Private - Requires authentication
 */
router.get(
  Order.getUserAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.getUserAddress
);

/**
 * @route GET /api/v1/order/userAddresses/user/:redemptionService?
 * @description Retrieves all shipping addresses for a user filtered by redemption service
 * @param {string} redemptionService - Identifier for the redemption service
 * @access Private - Requires authentication
 */
router.get(
  Order.getAllUserAddress,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.getAllUserAddress
);

/**
 * @route GET /api/v1/order/wait/event
 * @description Waits for an order event to occur and returns the event details
 * @param {string} orderHash - Hash of the order to wait for events (query parameter)
 * @param {string} [reserve] - Reserve address for the order (query parameter)
 * @param {string} [asset] - Asset address for the order (query parameter)
 * @access Private - Requires authentication
 */
router.get(
  Order.waitForOrderEvent,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.waitForOrderEvent
);

/**
 * @route POST /api/v1/order/sale/cancel
 * @description Cancels an existing sale order
 * @requestBody {string} saleOrderAddress - Blockchain address of the sale order to cancel
 * @access Private - Requires authentication
 */
router.post(
  Order.cancelSaleOrder,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.cancelSaleOrder
);

/**
 * @route POST /api/v1/order/closeSale
 * @description Completes an order by marking it as fulfilled
 * @requestBody {string} orderAddress - Blockchain address of the order to execute
 * @requestBody {number} fulfillmentDate - Unix timestamp for the fulfillment date
 * @requestBody {string} [comments] - Optional comments about the fulfillment
 * @access Private - Requires authentication
 */
router.post(
  Order.executeSale,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.executeSale
);

/**
 * @route PUT /api/v1/order/updateComment
 * @description Updates the comment on an existing order
 * @requestBody {string} saleOrderAddress - Blockchain address of the order to update
 * @requestBody {string} comments - New comment for the order
 * @access Private - Requires authentication
 */
router.put(
  Order.updateOrderComment,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderController.updateOrderComment
);

/**
 * @route POST /api/v1/order/saleQuantity
 * @description Checks the available quantity for a sale
 * @requestBody {string} assetAddress - Blockchain address of the asset to check
 * @access Public - Authentication optional (allowAnonAccess=true)
 */
router.post(
  Order.checkSaleQuantity,
  authHandler.authorizeRequest(true),
  loadDapp,
  OrderController.checkSaleQuantity
);

export default router;

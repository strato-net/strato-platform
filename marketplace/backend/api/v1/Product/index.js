/**
 * @fileoverview Product API routes configuration
 * 
 * This module defines all RESTful API routes for the Product service, which handles
 * product creation, retrieval, updating, and deletion operations.
 * Each route is protected by authentication middleware and uses the loadDapp middleware
 * to access blockchain data.
 * 
 * @module api/v1/Product
 */

import express from 'express';
import ProductController from './product.controller';
import { Product } from '../endpoints';
import authHandler from '../../middleware/authHandler';
import loadDapp from '../../middleware/loadDappHandler';

const router = express.Router();

/**
 * @route GET /api/v1/product/:address
 * @description Retrieves a specific product by its blockchain address
 * @param {string} address - Blockchain address of the product
 * @access Private - Requires authentication
 * @returns {Object} Product details
 */
router.get(
  Product.get,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductController.get
);

/**
 * @route GET /api/v1/product
 * @description Retrieves a list of all products with optional pagination
 * @param {number} [limit] - Maximum number of products to return (query parameter)
 * @param {number} [offset] - Number of products to skip (query parameter)
 * @access Private - Requires authentication
 * @returns {Object} Object containing products array and total count
 */
router.get(
  Product.getAll,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductController.getAll
);

/**
 * @route GET /api/v1/product/filter/names
 * @description Retrieves a list of all product names and their addresses
 * @access Public - Authentication optional (allowAnonAccess=true)
 * @returns {Array} List of product names with their addresses
 */
router.get(
  Product.getAllProductNames,
  authHandler.authorizeRequest(true),
  loadDapp,
  ProductController.getAllProductNames
);

/**
 * @route POST /api/v1/product
 * @description Creates a new product with the provided details
 * @requestBody {Object} productArgs - Product creation arguments
 * @requestBody {string} productArgs.name - Name of the product
 * @requestBody {string} productArgs.description - Description of the product
 * @requestBody {string} productArgs.manufacturer - Manufacturer of the product
 * @requestBody {number} productArgs.unitOfMeasurement - Unit of measurement (1-11)
 * @requestBody {string} productArgs.userUniqueProductCode - Unique product code
 * @requestBody {number} productArgs.leastSellableUnit - Smallest unit that can be sold
 * @requestBody {string} productArgs.imageKey - Key for the product image
 * @requestBody {boolean} productArgs.isActive - Whether the product is active
 * @requestBody {string} productArgs.category - Category of the product
 * @requestBody {string} productArgs.subCategory - Subcategory of the product
 * @access Private - Requires authentication
 * @returns {Object} Created product details
 */
router.post(
  Product.create,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductController.create
);

/**
 * @route PUT /api/v1/product/update
 * @description Updates an existing product with the provided details
 * @requestBody {string} productAddress - Blockchain address of the product to update
 * @requestBody {Object} updates - Update fields
 * @requestBody {string} [updates.description] - Updated description of the product
 * @requestBody {string} [updates.imageKey] - Updated key for the product image
 * @requestBody {boolean} [updates.isActive] - Updated status of the product
 * @requestBody {string} [updates.userUniqueProductCode] - Updated unique product code
 * @requestBody {string} [updates.oldImageKey] - Key of the old image to be deleted
 * @access Private - Requires authentication
 * @returns {Object} Updated product details
 */
router.put(
  Product.update,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductController.update
);

/**
 * @route PUT /api/v1/product/delete
 * @description Marks a product as deleted or removes it from the system
 * @requestBody {string} productAddress - Blockchain address of the product to delete
 * @access Private - Requires authentication
 * @returns {Object} Success indicator
 */
router.put(
  Product.delete,
  authHandler.authorizeRequest(),
  loadDapp,
  ProductController.delete
);

export default router;

/**
 * @fileoverview Product Controller
 * 
 * This module handles the business logic for product management in the marketplace,
 * including retrieving products, creating new products, updating existing products,
 * and deleting products. Each method interacts with the blockchain through the dapp object.
 * 
 * @module api/v1/Product/ProductController
 */

import { rest } from 'blockapps-rest';
import Joi from '@hapi/joi';
import RestStatus from 'http-status-codes';
import config from '../../../load.config';

const options = { config, cacheNonce: true };

class ProductController {
  /**
   * Retrieves a specific product by its blockchain address
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.params - Request parameters
   * @param {string} req.params.address - Blockchain address of the product
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns product details or passes error to next middleware
   */
  static async get(req, res, next) {
    try {
      const { dapp, params } = req;
      const { address } = params;

      let args;
      let chainOptions = options;

      if (address) {
        args = { address };
        chainOptions = { ...options };
      }

      const product = await dapp.getProduct(args, chainOptions);
      const result = { ...product, imageUrl: product.imageKey };
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves a list of all products with optional pagination
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit] - Maximum number of products to return
   * @param {number} [req.query.offset] - Number of products to skip
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns products list with count or passes error to next middleware
   */
  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const products = await dapp.getProducts({ ...query });
      const productsWithImageUrl = products.products;
      rest.response.status200(res, {
        productsWithImageUrl: productsWithImageUrl,
        count: products.productCount,
      });

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Retrieves a list of all product names and their addresses
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.query - Query parameters
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns list of product names or passes error to next middleware
   */
  static async getAllProductNames(req, res, next) {
    try {
      const { dapp, query } = req;

      const products = await dapp.getProductNames({ ...query });
      rest.response.status200(res, products);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Creates a new product with the provided details
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {Object} req.body.productArgs - Product creation arguments
   * @param {string} req.body.productArgs.name - Name of the product
   * @param {string} req.body.productArgs.description - Description of the product
   * @param {string} req.body.productArgs.manufacturer - Manufacturer of the product
   * @param {number} req.body.productArgs.unitOfMeasurement - Unit of measurement (1-11)
   * @param {string} req.body.productArgs.userUniqueProductCode - Unique product code
   * @param {number} req.body.productArgs.leastSellableUnit - Smallest unit that can be sold
   * @param {string} req.body.productArgs.imageKey - Key for the product image
   * @param {boolean} req.body.productArgs.isActive - Whether the product is active
   * @param {string} req.body.productArgs.category - Category of the product
   * @param {string} req.body.productArgs.subCategory - Subcategory of the product
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns created product or passes error to next middleware
   */
  static async create(req, res, next) {
    try {
      const { dapp, body } = req;

      ProductController.validateCreateProductArgs(body);

      const result = await dapp.createProduct(body);
      rest.response.status200(res, result);

      console.log('*Seller added product*');

      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Updates an existing product with the provided details
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.productAddress - Blockchain address of the product to update
   * @param {Object} req.body.updates - Update fields
   * @param {string} [req.body.updates.description] - Updated description of the product
   * @param {string} [req.body.updates.imageKey] - Updated key for the product image
   * @param {boolean} [req.body.updates.isActive] - Updated status of the product
   * @param {string} [req.body.updates.userUniqueProductCode] - Updated unique product code
   * @param {string} [req.body.updates.oldImageKey] - Key of the old image to be deleted
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns updated product or passes error to next middleware
   */
  static async update(req, res, next) {
    try {
      const { dapp, body } = req;

      ProductController.validateUpdateProductArgs(body);

      // If the old image key is present, delete the old image from S3. Keys are sent from UpdateProductModal.js
      const result = await dapp.updateProduct(body, options);

      rest.response.status200(res, result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  /**
   * Marks a product as deleted or removes it from the system
   * 
   * @async
   * @param {Object} req - Express request object
   * @param {Object} req.dapp - Dapp instance from loadDapp middleware
   * @param {Object} req.body - Request body
   * @param {string} req.body.productAddress - Blockchain address of the product to delete
   * @param {Object} res - Express response object
   * @param {Function} next - Express next middleware function
   * @returns {Promise<void>} - Returns success indicator or passes error to next middleware
   */
  static async delete(req, res, next) {
    try {
      const { dapp, body } = req;

      ProductController.validateDeleteProductArgs(body);

      const result = await dapp.deleteProduct(body, options);

      rest.response.status200(res, result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  // static async audit(req, res, next) {
  //   try {
  //     const { dapp, params } = req
  //     const { address, chainId } = params

  //     const result = await dapp.auditProduct({ address, chainId }, options)
  //     rest.response.status200(res, result)
  //   } catch (e) {
  //     return next(e)
  //   }
  // }

  // static async transferOwnership(req, res, next) {
  //   try {
  //     const { dapp, body } = req

  //     ProductController.validateTransferOwnershipArgs(body)
  //     const result = await dapp.transferOwnershipProduct(body, options)
  //     rest.response.status200(res, result)
  //   } catch (e) {
  //     return next(e)
  //   }
  // }

  // ----------------------- ARG VALIDATION ------------------------

  /**
   * Validates product creation arguments
   * 
   * @param {Object} args - Product creation arguments to validate
   * @param {Object} args.productArgs - Product arguments
   * @param {string} args.productArgs.name - Name of the product
   * @param {string} args.productArgs.description - Description of the product
   * @param {string} args.productArgs.manufacturer - Manufacturer of the product
   * @param {number} args.productArgs.unitOfMeasurement - Unit of measurement (1-11)
   * @param {string} args.productArgs.userUniqueProductCode - Unique product code
   * @param {number} args.productArgs.leastSellableUnit - Smallest unit that can be sold
   * @param {string} args.productArgs.imageKey - Key for the product image
   * @param {boolean} args.productArgs.isActive - Whether the product is active
   * @param {string} args.productArgs.category - Category of the product
   * @param {string} args.productArgs.subCategory - Subcategory of the product
   * @throws {RestError} - If validation fails
   */
  static validateCreateProductArgs(args) {
    const createProductSchema = Joi.object({
      productArgs: Joi.object({
        name: Joi.string().required(),
        description: Joi.string().required(),
        manufacturer: Joi.string().required(),
        unitOfMeasurement: Joi.number().integer().min(1).max(11).required(),
        userUniqueProductCode: Joi.string().allow('').required(),
        leastSellableUnit: Joi.number().required(),
        imageKey: Joi.string().required(),
        isActive: Joi.boolean().required(),
        category: Joi.string().required(),
        subCategory: Joi.string().required(),
      }),
    });

    const validation = createProductSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Create Product Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  /**
   * Validates product update arguments
   * 
   * @param {Object} args - Product update arguments to validate
   * @param {string} args.productAddress - Blockchain address of the product to update
   * @param {Object} args.updates - Update fields
   * @param {string} [args.updates.description] - Updated description of the product
   * @param {string} [args.updates.imageKey] - Updated key for the product image
   * @param {boolean} [args.updates.isActive] - Updated status of the product
   * @param {string} [args.updates.userUniqueProductCode] - Updated unique product code
   * @param {string} [args.updates.oldImageKey] - Key of the old image to be deleted
   * @throws {RestError} - If validation fails
   */
  static validateUpdateProductArgs(args) {
    const updateProductSchema = Joi.object({
      productAddress: Joi.string().required(),
      updates: Joi.object({
        description: Joi.string(),
        imageKey: Joi.string(),
        isActive: Joi.boolean(),
        userUniqueProductCode: Joi.string().allow(''),
        oldImageKey: Joi.string().optional(),
      }).required(),
    });

    const validation = updateProductSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Update Product Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  /**
   * Validates product deletion arguments
   * 
   * @param {Object} args - Product deletion arguments to validate
   * @param {string} args.productAddress - Blockchain address of the product to delete
   * @throws {RestError} - If validation fails
   */
  static validateDeleteProductArgs(args) {
    const deleteProductSchema = Joi.object({
      productAddress: Joi.string().required(),
    });

    const validation = deleteProductSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Delete Product Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  /**
   * Validates product ownership transfer arguments
   * 
   * @param {Object} args - Ownership transfer arguments to validate
   * @param {string} args.address - Blockchain address of the product
   * @param {string} args.chainId - Blockchain chain ID where the product exists
   * @param {string} args.newOwner - Blockchain address of the new owner
   * @throws {RestError} - If validation fails
   */
  static validateTransferOwnershipArgs(args) {
    const transferOwnershipProductSchema = Joi.object({
      address: Joi.string().required(),
      chainId: Joi.string().required(),
      newOwner: Joi.string().required(),
    });

    const validation = transferOwnershipProductSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Transfer Ownership Product Argument Validation Error',
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default ProductController;

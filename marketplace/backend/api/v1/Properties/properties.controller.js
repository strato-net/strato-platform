import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import { getSignedUrlFromS3, deleteFileFromS3, uploadFileToS3 } from '../../../helpers/s3'
import constants from '../../../helpers/constants'
import moment from 'moment'
import crypto from "crypto";

const options = { config, cacheNonce: true }

class PropertiesController {
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

      const property = await dapp.getProperty(args, chainOptions);
      // const productImageUrl = getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName))
      // const result = { ...product, imageUrl: productImageUrl }
      rest.response.status200(res, property);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const properties = await dapp.getProperties({ ...query });
      // const productsWithImageUrl = products.map(product => ({
      //   ...product,
      //   imageUrl: getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName)
      //   )
      // }))

      rest.response.status200(res, properties);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async create(req, res, next) {
    try {
      const {
        dapp,
        body,
        files,
        body: {
          streetNumber,
          streetName,
          unitNumber,
          postalCity,
          stateOrProvince,
          postalcode,
        },
      } = req;

      const propertyArgs = {
        ...body,
        standardStatus: "Active",
        //use google maps api to get lat and long, then convert to string
        latitude: "",
        longitude: "",
      };

      PropertiesController.validateCreatePropertyArgs(propertyArgs);

      const propertyResult = await dapp.createProperty(propertyArgs);
      if (propertyResult) {

        /* -------upload the documents and images if necessary-------- */
        if (files) {
          files.forEach(async (file) => {
            const fileKey = `${moment()
              .utc()
              .valueOf()}_${file.originalname}`;

            const fileHash = crypto
              .createHmac("sha256", file.buffer)
              .digest("hex");


            const uploadResult = await uploadFileToS3(
              `${fileKey}`,
              file.buffer,
              req.app.get(constants.s3ParamName)
            );

            const productDocumentArgs = {
              productId: propertyResult.productContractAddress,
              fileKey,
              fileHash,
              fileName: file.originalname,
              fileLocation: uploadResult.Location,
              documentType: file.mimetype,
            }

            PropertiesController.validateCreateProductDocumentArgs(productDocumentArgs)

            await dapp.createProductDocument(productDocumentArgs)
          })
        }

        const inventoryBody = {
          productAddress: propertyResult.productContractAddress,
          quantity: 1,
          pricePerUnit: propertyArgs.listPrice,
          batchId: "1",
          status: 1,
          serialNumber: [],
        };
        const inventoryResult = await dapp.createInventory(inventoryBody);
        if (inventoryResult) {
          console.log("propertyResult", propertyResult);
          rest.response.status200(res, propertyResult);
        }
      }

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async update(req, res, next) {
    try {
      const {
        dapp,
        body,
        body: {
          streetNumber,
          streetName,
          unitNumber,
          postalCity,
          stateOrProvince,
          postalcode,
        },
      } = req;

      const propertyArgs = {
        ...body,
        standardStatus: "Active",
        //use google maps api to get lat and long, then convert to string
        latitude: "",
        longitude: "",
      };

      PropertiesController.validateUpdatePropertyArgs(propertyArgs);

      const updatedProperty = await dapp.updateProperty(propertyArgs);
      rest.response.status200(res, updatedProperty);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async createReview(req, res, next) {
    try {
      const { dapp, body } = req;
      console.log("createReview body", body);
      PropertiesController.validateCreateReviewArgs(body);
      const result = await dapp.createReview(body);
      console.log("createReview - result", result);
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async updateReview(req, res, next) {
    try {
      const {
        dapp,
        body,
      } = req;
      console.log("updateReview body", body);

      PropertiesController.validateUpdateReviewArgs(body);

      const updatedReview = await dapp.updateReview(body);
      rest.response.status200(res, updatedReview);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async deleteReview(req, res, next) {
    try {
      const { dapp, body } = req;

      PropertiesController.validateDeleteReviewArgs(body);

      const result = await dapp.deleteReview(body, options);

      rest.response.status200(res, result);
      return next();
    } catch (e) {
      return next(e);
    }
  }

  // ----------------------- ARG VALIDATION ------------------------

  static validateCreatePropertyArgs(args) {
    const createPropertySchema = Joi.object({
      title: Joi.string().required(),
      description: Joi.string().required(),
      propertyType: Joi.string().required(),
      listPrice: Joi.number().required(),
      streetNumber: Joi.number().required(),
      streetName: Joi.string().required(),
      unitNumber: Joi.string().allow("").required(),
      postalCity: Joi.string().required(),
      stateOrProvince: Joi.string().required(),
      postalcode: Joi.number().required(),
      bathroomsTotalInteger: Joi.number().required(),
      bedroomsTotal: Joi.number().required(),
      standardStatus: Joi.string().required(),
      lotSizeArea: Joi.number().required(),
      lotSizeUnits: Joi.string().required(),
      livingArea: Joi.number().required(),
      livingAreaUnits: Joi.string().required(),
      latitude: Joi.string().allow("").required(),
      longitude: Joi.string().allow("").required(),
      numberOfUnitsTotal: Joi.number().required(),

      // Appliances
      dishwasher: Joi.boolean().required(),
      dryer: Joi.boolean().required(),
      freezer: Joi.boolean().required(),
      garbageDisposal: Joi.boolean().required(),
      microwave: Joi.boolean().required(),
      ovenOrRange: Joi.boolean().required(),
      refrigerator: Joi.boolean().required(),
      washer: Joi.boolean().required(),
      waterHeater: Joi.boolean().required(),

      // Cooling
      centralAir: Joi.boolean().required(),
      evaporative: Joi.boolean().required(),
      geoThermal: Joi.boolean().required(),
      refrigeration: Joi.boolean().required(),
      solar: Joi.boolean().required(),
      wallUnit: Joi.boolean().required(),

      // Heating
      baseboard: Joi.boolean().required(),
      forceAir: Joi.boolean().required(),
      geoThermalHeat: Joi.boolean().required(),
      heatPump: Joi.boolean().required(),
      hotWater: Joi.boolean().required(),
      radiant: Joi.boolean().required(),
      solarHeat: Joi.boolean().required(),
      steam: Joi.boolean().required(),

      // Flooring
      carpet: Joi.boolean().required(),
      concrete: Joi.boolean().required(),
      hardwood: Joi.boolean().required(),
      laminate: Joi.boolean().required(),
      linoleumVinyl: Joi.boolean().required(),
      slate: Joi.boolean().required(),
      softwood: Joi.boolean().required(),
      tile: Joi.boolean().required(),

      // Parking
      carport: Joi.boolean().required(),
      garage: Joi.boolean().required(),
      offStreet: Joi.boolean().required(),
      onStreet: Joi.boolean().required(),

      // Interior Features
      attic: Joi.boolean().required(),
      cableReady: Joi.boolean().required(),
      ceilingFan: Joi.boolean().required(),
      doublePaneWindows: Joi.boolean().required(),
      elevator: Joi.boolean().required(),
      fireplace: Joi.boolean().required(),
      flooring: Joi.boolean().required(),
      furnished: Joi.boolean().required(),
      jettedTub: Joi.boolean().required(),
      securitySystem: Joi.boolean().required(),
      vaultedCeiling: Joi.boolean().required(),
      skylight: Joi.boolean().required(),
      wetBar: Joi.boolean().required(),

      // Exterior Features
      barbecueArea: Joi.boolean().required(),
      deck: Joi.boolean().required(),
      dock: Joi.boolean().required(),
      fence: Joi.boolean().required(),
      garden: Joi.boolean().required(),
      hotTubOrSpa: Joi.boolean().required(),
      lawn: Joi.boolean().required(),
      patio: Joi.boolean().required(),
      pond: Joi.boolean().required(),
      pool: Joi.boolean().required(),
      porch: Joi.boolean().required(),
      rvParking: Joi.boolean().required(),
      sauna: Joi.boolean().required(),
      sprinklerSystem: Joi.boolean().required(),
      waterFront: Joi.boolean().required(),
    });

    const validation = createPropertySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Property Argument Validation Error',
        `Missing args or bad format: ${validation.error.message}`)
    }
  }

  static validateCreateProductDocumentArgs(args) {
    const createProductDocumentSchema = Joi.object({
      productId: Joi.string().required(),
      fileKey: Joi.string().required(),
      fileHash: Joi.string().required(),
      fileName: Joi.string().required(),
      fileLocation: Joi.string().required(),
      documentType: Joi.string().required(),
    });

    const validation = createProductDocumentSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create ProductDocument Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        "Create Property Argument Validation Error",
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateUpdatePropertyArgs(args) {
    const updatePropertySchema = Joi.object({
      productId: Joi.string().required(),
      propertyAddress: Joi.string().required(),
      title: Joi.string().required(),
      description: Joi.string().required(),
      propertyType: Joi.string().required(),
      listPrice: Joi.number().required(),
      streetNumber: Joi.number().required(),
      streetName: Joi.string().required(),
      unitNumber: Joi.string().allow("").required(),
      postalCity: Joi.string().required(),
      stateOrProvince: Joi.string().required(),
      postalcode: Joi.number().required(),
      bathroomsTotalInteger: Joi.number().required(),
      bedroomsTotal: Joi.number().required(),
      standardStatus: Joi.string().required(),
      lotSizeArea: Joi.number().required(),
      lotSizeUnits: Joi.string().required(),
      livingArea: Joi.number().required(),
      livingAreaUnits: Joi.string().required(),
      latitude: Joi.string().allow("").required(),
      longitude: Joi.string().allow("").required(),
      numberOfUnitsTotal: Joi.number().required(),

      // Appliances
      dishwasher: Joi.boolean().required(),
      dryer: Joi.boolean().required(),
      freezer: Joi.boolean().required(),
      garbageDisposal: Joi.boolean().required(),
      microwave: Joi.boolean().required(),
      ovenOrRange: Joi.boolean().required(),
      refrigerator: Joi.boolean().required(),
      washer: Joi.boolean().required(),
      waterHeater: Joi.boolean().required(),

      // Cooling
      centralAir: Joi.boolean().required(),
      evaporative: Joi.boolean().required(),
      geoThermal: Joi.boolean().required(),
      refrigeration: Joi.boolean().required(),
      solar: Joi.boolean().required(),
      wallUnit: Joi.boolean().required(),

      // Heating
      baseboard: Joi.boolean().required(),
      forceAir: Joi.boolean().required(),
      geoThermalHeat: Joi.boolean().required(),
      heatPump: Joi.boolean().required(),
      hotWater: Joi.boolean().required(),
      radiant: Joi.boolean().required(),
      solarHeat: Joi.boolean().required(),
      steam: Joi.boolean().required(),

      // Flooring
      carpet: Joi.boolean().required(),
      concrete: Joi.boolean().required(),
      hardwood: Joi.boolean().required(),
      laminate: Joi.boolean().required(),
      linoleumVinyl: Joi.boolean().required(),
      slate: Joi.boolean().required(),
      softwood: Joi.boolean().required(),
      tile: Joi.boolean().required(),

      // Parking
      carport: Joi.boolean().required(),
      garage: Joi.boolean().required(),
      offStreet: Joi.boolean().required(),
      onStreet: Joi.boolean().required(),

      // Interior Features
      attic: Joi.boolean().required(),
      cableReady: Joi.boolean().required(),
      ceilingFan: Joi.boolean().required(),
      doublePaneWindows: Joi.boolean().required(),
      elevator: Joi.boolean().required(),
      fireplace: Joi.boolean().required(),
      flooring: Joi.boolean().required(),
      furnished: Joi.boolean().required(),
      jettedTub: Joi.boolean().required(),
      securitySystem: Joi.boolean().required(),
      vaultedCeiling: Joi.boolean().required(),
      skylight: Joi.boolean().required(),
      wetBar: Joi.boolean().required(),

      // Exterior Features
      barbecueArea: Joi.boolean().required(),
      deck: Joi.boolean().required(),
      dock: Joi.boolean().required(),
      fence: Joi.boolean().required(),
      garden: Joi.boolean().required(),
      hotTubOrSpa: Joi.boolean().required(),
      lawn: Joi.boolean().required(),
      patio: Joi.boolean().required(),
      pond: Joi.boolean().required(),
      pool: Joi.boolean().required(),
      porch: Joi.boolean().required(),
      rvParking: Joi.boolean().required(),
      sauna: Joi.boolean().required(),
      sprinklerSystem: Joi.boolean().required(),
      waterFront: Joi.boolean().required(),
    });

    const validation = updatePropertySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `Update Property Argument Validation Error`,
        `Missing args or bad format: ${validation.error.message}`
      );
    }
  }
  
  static validateCreateReviewArgs(args) {
    const createReviewSchema = Joi.object({
      productId: Joi.string().required(),
      propertyId: Joi.string().required(),
      reviewerAddress: Joi.string().required(),
      reviewerName: Joi.string().required(),
      title: Joi.string().required(),
      description: Joi.string().required(),
      rating: Joi.number().required(),
    });

    const validation = createReviewSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        "Create Review Argument Validation Error",
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }

  static validateUpdateReviewArgs(args) {
    const updateReviewSchema = Joi.object({
      title: Joi.string().required(),
      description: Joi.string().required(),
      rating: Joi.number().required(),
      address: Joi.string().required(),
    });

    const validation = updateReviewSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `Update Review Argument Validation Error`,
        `Missing args or bad format: ${validation.error.message}`
      );
    }
  }

  static validateDeleteReviewArgs(args) {
    const deleteReviewSchema = Joi.object({
      address: Joi.string().required(),
    });

    const validation = deleteReviewSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        "Delete Review Argument Validation Error",
        {
          message: `Missing args or bad format: ${validation.error.message}`,
        }
      );
    }
  }
}

export default PropertiesController;

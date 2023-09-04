import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import { getSignedUrlFromS3, deleteFileFromS3, uploadFileToS3 } from '../../../helpers/s3'
import { geocodeAddress } from '../../../helpers/geocoding'
import constants from '../../../helpers/constants'
import { getServiceToken } from '../../../helpers/oauthHelper'

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
      console.log('controller -getproperty', property)
      const imageUrls = [];
      await property.images.forEach(image => {
        const url = getSignedUrlFromS3(image.fileKey, req.app.get(constants.s3ParamName))
        imageUrls.push(url)
      })


      const result = { ...property, images: imageUrls }
      console.log('controller -result', result)
      rest.response.status200(res, result);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req;

      const properties = await dapp.getProperties({ ...query });

      // const result = properties.map(property => ({
      // }))

      rest.response.status200(res, properties);

      return next();
    } catch (e) {
      return next(e);
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body, files } = req;

      const propertyArgs = {
        ...body,
        standardStatus: "Active",
        //use google maps api to get lat and long, then convert to string
        latitude: '',
        longitude: '',
      };

      //Get coordinates for the address
      await geocodeAddress(`${body.streetNumber} ${body.streetName}, ${body.postalCity} ${body.stateOrProvince} ${body.postalcode}`)
        .then(coordinates => {
          if (coordinates) {
            propertyArgs.longitude = JSON.stringify(coordinates[0])
            propertyArgs.latitude = JSON.stringify(coordinates[1])
          } else {
            rest.response.status400('Geocoding failed for the provided address.');
          }
        })
        .catch(err => {
          rest.response.status400(err);
        });

      PropertiesController.validateCreatePropertyArgs(propertyArgs);

      const propertyResult = await dapp.createProperty(propertyArgs);
      if (propertyResult) {

        const inventoryBody = {
          productAddress: propertyResult.productContractAddress,
          quantity: 1,
          pricePerUnit: propertyArgs.listPrice,
          batchId: "1",
          status: 1,
          serialNumber: [],
        };
        const inventoryResult = await dapp.createInventory(inventoryBody);

        /* -------upload the documents and images if necessary-------- */
        if (files) {
          //Access token for the image upload
          // const accessToken = await getServiceToken();
          // Need to get this accessToken manually and change with curl command -
          // curl - L - X POST 'https://keycloak.blockapps.net/auth/realms/mercata-testnet2/protocol/openid-connect/token' \
          // -H 'Content-Type: application/x-www-form-urlencoded' \
          // -H 'Authorization: Basic bWVyY2F0YS10ZXN0bmV0Mi1ub2RlMTowMTAzMDAxYS0zYjc2LTRiZDItOGE0NC05ZWRjYTRhMzI1NzE=' \
          // --data - urlencode 'grant_type=password' \
          // --data - urlencode 'username=<username>' \
          // --data - urlencode 'password=<password>' \
          const accessToken = 'eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJheWpsYmFGenhrTFM3Rld6Tl9OY2ZpdVFPNU9rSm9mMTVNRGFiUm1Pc2g0In0.eyJqdGkiOiI4ODYyNWYxMS1kZmU2LTQ0NjEtOTY2Ny1iMGIzYWExNDFiNTgiLCJleHAiOjE2OTM1MTAzODYsIm5iZiI6MCwiaWF0IjoxNjkzNTA2Nzg2LCJpc3MiOiJodHRwczovL2tleWNsb2FrLmJsb2NrYXBwcy5uZXQvYXV0aC9yZWFsbXMvbWVyY2F0YS10ZXN0bmV0MiIsImF1ZCI6ImFjY291bnQiLCJzdWIiOiJhZGI4MWJlNi02YTI3LTQ4MjYtYWI0MS04MGM4M2I3YWU0MTYiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJtZXJjYXRhLXRlc3RuZXQyLW5vZGUxIiwiYXV0aF90aW1lIjowLCJzZXNzaW9uX3N0YXRlIjoiZDU4ODRlMjEtZWRkOC00MWEzLWJjYmUtYzZjMGY1MWRiZjBjIiwiYWNyIjoiMSIsInJlYWxtX2FjY2VzcyI6eyJyb2xlcyI6WyJvZmZsaW5lX2FjY2VzcyIsInVtYV9hdXRob3JpemF0aW9uIl19LCJyZXNvdXJjZV9hY2Nlc3MiOnsiYWNjb3VudCI6eyJyb2xlcyI6WyJtYW5hZ2UtYWNjb3VudCIsIm1hbmFnZS1hY2NvdW50LWxpbmtzIiwidmlldy1wcm9maWxlIl19fSwic2NvcGUiOiJwcm9maWxlIGVtYWlsIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJNaWNoYWVsIFRhbiIsImNvbXBhbnkiOiIiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJtaWNoYWVsX3RhbkBibG9ja2FwcHMubmV0IiwiZ2l2ZW5fbmFtZSI6Ik1pY2hhZWwiLCJmYW1pbHlfbmFtZSI6IlRhbiIsImVtYWlsIjoibWljaGFlbF90YW5AYmxvY2thcHBzLm5ldCJ9.IcROrKZb8Q5OcSkmjfXp0IH8kp62JgJ_dEIEHwage3PAi4RUbkz7GCZFo8NhBiJGoZW52X4_5BDMTUM2gc_Uo41QQceDAgMBOuJrusU8ZHsH6wS6YXq2vx_pzKlbvsdNH5vupN1mEswiw4odUqp-D413xIzAG0dkUjDCN501XCMrfydgZK9YIiVPoFZv2T-IQp2Ihog2W9G7qbfS28jJeY1j_fC4e5hZlRv-hkSZfbtEcR3bZTsjz4aJ98ri0OHVwwfF8JqpxqrUifQQgGMLw9NqMIsbXlDzYHaSvAuicrunkdUtd4AvDUi_8TurdZ7us9nDFV3U4A2156g-gvBOKQ'
          for (let i = 0; i < files.length; i++) {
            console.log("contorller-files", files[i].originalname);
            const uploadResult = await uploadFileToS3(
              process.env.EXTERNAL_STORAGE_URL,
              files[i],
              accessToken
            );

            console.log("uploadResult", uploadResult);

            const productDocumentArgs = {
              productId: propertyResult.productContractAddress,
              fileKey: uploadResult.data.imageKey,
              fileName: files[i].originalname,
              documentType: files[i].mimetype,
            }
            console.log("productDocumentArgs", productDocumentArgs);
            PropertiesController.validateCreateProductDocumentArgs(productDocumentArgs)

            const uploaded = await dapp.createProductDocument(productDocumentArgs)
            console.log("uploadedFILE", uploaded);
          }
        }

        if (propertyResult && inventoryResult) {
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
      fileName: Joi.string().required(),
      documentType: Joi.string().required(),
    });

    const validation = createProductDocumentSchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create ProductDocument Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
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
      reviewAddress: Joi.string().required(),
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

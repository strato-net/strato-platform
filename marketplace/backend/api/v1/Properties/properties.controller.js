import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import { getSignedUrlFromS3, deleteFileFromS3 } from '../../../helpers/s3'
import constants from '../../../helpers/constants'

const options = { config, cacheNonce: true }

class PropertiesController {

  static async get(req, res, next) {
    try {
      const { dapp, params } = req
      const { address } = params

      let args
      let chainOptions = options

      if (address) {
        args = { address }
        chainOptions = { ...options }
      }

      const property = await dapp.getProperty(args, chainOptions)
      // const productImageUrl = getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName))
      // const result = { ...product, imageUrl: productImageUrl }
      rest.response.status200(res, result)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req

      const properties = await dapp.getProperties({ ...query })
      // const productsWithImageUrl = products.map(product => ({
      //   ...product,
      //   imageUrl: getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName)
      //   )
      // }))

      rest.response.status200(res, productsWithImageUrl)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      // const propertyArgs = {
      //   title: body.title,
      //   description: body.description,
      //   propertyType: body.propertyType,
      //   // parcelNumber: 
      //   listPrice: body.listPrice,
      //   unparsedAddress: `${body.streetNumber} ${body.streetName} ${body.unitNumber}, ${body.postalCity}, ${body.stateOrProvince} ${body.postalCode}`,
      //   streetNumber: body.streetNumber,
      //   streetName: body.streetName,
      //   unitNumber: body.unitNumber,
      //   postalCity: state.postalCity,
      //   stateOrProvince: body.stateOrProvince,
      //   postalcode: body.postalCode,
      //   bathroomsTotalInteger: body.bathroomsTotalInteger,
      //   bedroomsTotal: body.bedroomsTotal,
      //   standardStatus: "Active",
      //   // lotSizeArea: 
      //   // lotSizeUnits: 
      //   // livingArea: 
      //   // livingAreaUnits: 
      //   // latitude: 
      //   // longitude: 
      //   listAgentFullName: '',
      //   listAgentEmail: '',
      //   listAgentPreferredPhone: '', 
      //   // appliances: 
      //   // cooling: 
      //   // heat: 
      //   // numberOfUnitsTotal: 
      //   // parkingFeatures: 
      //   // interiorFeatures: 
      //   // exteriorFeatures: 
      //   images: body.images
      // }

      console.log('controller body', body)
      PropertiesController.validateCreatePropertyArgs(body)

      const propertyResult = await dapp.createProperty(body)
      console.log('propertyResult controller', propertyResult)
      if (propertyResult) {
        const inventoryBody = {
          productAddress: propertyResult.productContractAddress,
          quantity: 1,
          pricePerUnit: body.listPrice,
          batchId: '1',
          status: 1,
          serialNumber: [],
        }
        console.log(inventoryBody)
        const inventoryResult = await dapp.createInventory(inventoryBody)
        console.log('inventoryResult controller', inventoryResult)
        if (inventoryResult) {
          rest.response.status200(res, propertyResult)
        }
      }

      return next()
    } catch (e) {
      return next(e)
    }
  }


  // ----------------------- ARG VALIDATION ------------------------

  static validateCreatePropertyArgs(args) {
    const createPropertySchema = Joi.object({
        title: Joi.string().required(),
        description: Joi.string().required(),
        propertyType: Joi.string().required(),
        listPrice: Joi.number().required(),
        unparsedAddress: Joi.string().required(),
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
        latitude: Joi.string(),
        longitude: Joi.string(),
        appliances: Joi.array().items(Joi.string()),
        cooling: Joi.array().items(Joi.string()),
        heating: Joi.array().items(Joi.string()),
        flooring: Joi.array().items(Joi.string()),
        numberOfUnitsTotal: Joi.number().required(),
        parkingFeatures: Joi.array().items(Joi.string()),
        interiorFeatures: Joi.array().items(Joi.string()),
        exteriorFeatures: Joi.array().items(Joi.string()),
        images: Joi.array().items(Joi.string()),
    });

    const validation = createPropertySchema.validate(args);

    if (validation.error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Property Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

}

export default PropertiesController
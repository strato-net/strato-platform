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
      rest.response.status200(res, property)

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

      rest.response.status200(res, properties)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async create(req, res, next) {
    try {
      const { dapp, body } = req

      const propertyArgs = {
        ...body,
        unparsedAddress: `${body.streetNumber} ${body.streetName} ${body.unitNumber}, ${body.postalCity}, ${body.stateOrProvince} ${body.postalCode}`,
        standardStatus: "Active",
        //use google maps api to get lat and long, then convert to string
        latitude: '',
        longitude: '',
      }

      console.log('controller body', body)
      PropertiesController.validateCreatePropertyArgs(propertyArgs)

      const propertyResult = await dapp.createProperty(body)
      console.log('propertyResult controller', propertyResult)
      if (propertyResult) {
        const inventoryBody = {
          productAddress: propertyResult.productContractAddress,
          quantity: 1,
          pricePerUnit: propertyArgs.listPrice,
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
      throw new rest.RestError(RestStatus.BAD_REQUEST, 'Create Property Argument Validation Error', {
        message: `Missing args or bad format: ${validation.error.message}`,
      })
    }
  }

}

export default PropertiesController
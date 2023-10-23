import { rest } from 'blockapps-rest'
import Joi from '@hapi/joi'
import RestStatus from 'http-status-codes'
import config from '../../../load.config'
import constants from '../../../helpers/constants'
import { getSignedUrlFromS3 } from '../../../helpers/s3'

const options = { config, cacheNonce: true }

class MarketplaceController {

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req
      if (query.manufacturer) {
        const encodedManufacturers = query.manufacturer.map(product => { return encodeURIComponent(product) })
        query.manufacturer = encodedManufacturers
      }
      const inventories = await dapp.getMarketplaceInventories({ ...query })

      const productsWithImageUrl = inventories
        .map(product => (
          product.imageKey ?
          {
          ...product,
          imageUrl: getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName))
        }
        : product
        ))
      rest.response.status200(res, productsWithImageUrl)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAllLoggedIn(req, res, next) {
    try {
      const { dapp, query } = req
      
      if (query.manufacturer) {
        const encodedManufacturers = query.manufacturer.map(product => { return encodeURIComponent(product) })
        query.manufacturer = encodedManufacturers
      }
      const inventories = await dapp.getMarketplaceInventoriesLoggedIn({ ...query })

      const productsWithImageUrl = inventories
        .map(product => (
          product.imageKey ? 
          {
          ...product,
          imageUrl: getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName))
          }
          : product
        ))
      rest.response.status200(res, productsWithImageUrl)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getTopSellingProducts(req, res, next) {
    try {
      const { dapp, query } = req
      const inventories = await dapp.getTopSellingProducts({ ...query })
      const productsWithImageUrl = inventories.map(product => (
        product.imageKey ?
        {
        ...product,
        imageUrl: getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName)
        )}
        :
        product
      ))
      rest.response.status200(res, productsWithImageUrl)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getTopSellingProductsLoggedIn(req, res, next) {
    try {
      const { dapp, query } = req
      const inventories = await dapp.getTopSellingProductsLoggedIn({ ...query })
      const productsWithImageUrl = inventories.map(product => (
        product.imageKey ?
        {
        ...product,
        imageUrl: getSignedUrlFromS3(product.imageKey, req.app.get(constants.s3ParamName)
        )} : product
      ))
      rest.response.status200(res, productsWithImageUrl)

      return next()
    } catch (e) {
      return next(e)
    }
  }
}



export default MarketplaceController

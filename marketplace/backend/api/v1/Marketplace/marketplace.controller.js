import { rest } from 'blockapps-rest'
import constants from '../../../helpers/constants'


class MarketplaceController {

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req
      const {soldOut, forSale , ...restQuery} =  query  
      if (query.manufacturer) {
        const encodedManufacturers = query.manufacturer.map(product => { return encodeURIComponent(product) })
        query.manufacturer = encodedManufacturers
      }
      const inventories = await dapp.getMarketplaceInventories({ ...restQuery })
      let finalInventory = MarketplaceController.getFinalInventory(inventories, forSale, soldOut)

      rest.response.status200(res, { productsWithImageUrl: finalInventory, inventoryCount: finalInventory?.length })

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAllLoggedIn(req, res, next) {
    try {
      const { dapp, query } = req
      const {soldOut, forSale , ...restQuery} =  query  
      if (query.manufacturer) {
        const encodedManufacturers = query.manufacturer.map(product => { return encodeURIComponent(product) })
        query.manufacturer = encodedManufacturers
      }
      const inventories = await dapp.getMarketplaceInventoriesLoggedIn({ ...restQuery })

      let finalInventory = MarketplaceController.getFinalInventory(inventories, forSale, soldOut)
      rest.response.status200(res, { productsWithImageUrl: finalInventory, inventoryCount: finalInventory?.length })

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getTopSellingProducts(req, res, next) {
    try {
      const { dapp, query } = req
      const inventories = await dapp.getTopSellingProducts({ ...query })
      const productsWithImageUrl = inventories.sort((a, b) => {
        return b.saleDate.localeCompare(a.saleDate);
      });

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
      const productsWithImageUrl = inventories.sort((a, b) => {
        return b.saleDate.localeCompare(a.saleDate);
      });

      rest.response.status200(res, productsWithImageUrl)

      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getStratsBalance(req, res, next) {
    try {
      const { dapp, address: userAddress } = req
      let stratsBalance = 0;

      stratsBalance = await dapp.getStratsBalance({ userAddress: userAddress });

      return rest.response.status200(res, stratsBalance)
    } catch (e) {
      console.log("Couldn't load STRATS");
      return next(e)
    }
  }

  static getFinalInventory(inventories, forSale, soldOut) {
    let unlisted = []
    let listed = inventories?.inventoryResults?.filter((item, index) => {

      //for ba sellers, get all assets - display For Sale and Sold Out
      if (constants.baUserNames.includes(item.ownerCommonName)) //
      {
        if (item.saleQuantity && item.saleQuantity !== 0) {
          return item
        } else {
          unlisted.push(item)
        }
      }
      else { // for non-ba sellers, get assets with valid sale & saleQty > 0 - display only For Sale records
        if (item.saleQuantity && item.saleQuantity !== 0) {
          return item
        }
      }
    })

    listed = listed.sort((a, b) => {
      return b?.saleDate?.localeCompare(a?.saleDate)
    })

    let finalInventory
    if (forSale === 'true' && soldOut === 'true') {
      finalInventory = [...listed, ...unlisted]
    } else if (forSale === 'true' && soldOut === 'false') {
      finalInventory = [...listed]
    } else if (forSale === 'false' && soldOut === 'true') {
      finalInventory = [...unlisted]
    } else {
      finalInventory = []
    }
    return finalInventory
  }

  static async getPriceHistory(req, res, next) {
    try {
      const { dapp, query } = req
      const { assetToBeSold, limit, offset } = query;

      const priceHistoryData = await dapp.getPriceHistory({ assetAddress: assetToBeSold, limit: limit, offset: offset });

      return rest.response.status200(res, priceHistoryData)
    } catch (e) {
      console.log("Couldn't fetch price history");
      return next(e)
    }
  }
}



export default MarketplaceController

import { rest } from 'blockapps-rest'

class MarketplaceController {

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req
      if (query.manufacturer) {
        const encodedManufacturers = query.manufacturer.map(product => { return encodeURIComponent(product) })
        query.manufacturer = encodedManufacturers
      }
      const inventories = await dapp.getMarketplaceInventories({ ...query })

      const productsWithImageUrl = inventories?.inventoryResults.sort((a, b) => {
        return b?.saleDate?.localeCompare(a?.saleDate);
      });
      rest.response.status200(res, { productsWithImageUrl: productsWithImageUrl, inventoryCount: inventories?.inventoryCount })

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

      const productsWithImageUrl = inventories?.inventoryResults.sort((a, b) => {
        return b?.saleDate?.localeCompare(a?.saleDate);
      });
      rest.response.status200(res, { productsWithImageUrl: productsWithImageUrl, inventoryCount: inventories?.inventoryCount })

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
}



export default MarketplaceController

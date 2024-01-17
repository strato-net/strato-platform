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
        return b.saleDate.localeCompare(a.saleDate);
      });
      rest.response.status200(res, {productsWithImageUrl: productsWithImageUrl, inventoryCount: inventories?.inventoryCount})

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
        if (a.saleDate && b.saleDate) {
          return b.saleDate.localeCompare(a.saleDate); // Sort by saleDate if both exist.
        } else if (a.saleDate) {
          return -1; // a has saleDate but b doesn't, so a comes first.
        } else if (b.saleDate) {
          return 1; // b has saleDate but a doesn't, so b comes first.
        } else {
          // Both a and b don't have saleDate, use block_timestamp.
          return b.block_timestamp.localeCompare(a.block_timestamp);
        }
      });
      
      rest.response.status200(res, {productsWithImageUrl: productsWithImageUrl, inventoryCount: inventories?.inventoryCount})

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
}



export default MarketplaceController

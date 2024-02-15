import { rest } from 'blockapps-rest'

class UserActivityController {

  static async getAll(req, res, next) {
    try {
      const { dapp, query } = req
     const orderRecieved = await dapp.

      // const productsWithImageUrl = inventories?.inventoryResults.sort((a, b) => {
      //   return b.saleDate.localeCompare(a.saleDate);
      // });
      rest.response.status200(res, { })

      return next()
    } catch (e) {
      return next(e)
    }
  }
}

export default UserActivityController

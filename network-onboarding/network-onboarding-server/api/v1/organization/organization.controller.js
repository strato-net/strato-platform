import { rest } from 'blockapps-rest'

class OrganizationController {
  static async updateOrganization(req, res, next) {
    try {
      const { dapp, body, params } = req

      const args = {
        ...body,
        organization: params.id,
      }

      const result = await dapp.managers.organizationManager.updateOrganization(args)
      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }

  static async getAll(req, res, next) {
    try {
      const { dapp } = req

      const result = await dapp.managers.organizationManager.getAll()
      rest.response.status200(res, result)
      return next()
    } catch (e) {
      return next(e)
    }
  }
}

export default OrganizationController

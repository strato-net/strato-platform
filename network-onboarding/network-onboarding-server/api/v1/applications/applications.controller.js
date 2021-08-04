import { rest } from 'blockapps-rest'

class ApplicationsController {
    // Create
    static async createApplication(req, res, next) {
        try {
            const { dapp, body } = req
            const result = await dapp.createApplication(body)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }

    // Read - Nothing to read?

    // Update
    static async addOrganizationToApplication(req, res, next) {}


    static async inviteOrganizationToApplication(req, res, next) {}

    static async inviteOrganizationToApplicationAccept(req, res, next) {}

    static async inviteOrganizationToApplicationReject(req, res, next) {}


    static async requestOrganizationToApplication(req, res, next) {}

    static async requestOrganizationToApplicationAccept(req, res, next) {}

    static async requestOrganizationToApplicationReject(req, res, next) {}



    static async getOrganizations(req, res, next) {}

    static async getOrganizationInvites(req, res, next) {}

    static async getOrganizationRequests(req, res, next) {}


    static async removeOrganizationFromApplication(req, res, next) {}


    // Delete
    static async removeOrganization(req, res, next) {}
}

export default ApplicationsController

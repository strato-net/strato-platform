import { rest } from 'blockapps-rest'

class OrganizationsController {
    // Create
    static async createOrganization(req, res, next) {}

    static async inviteOrganization(req, res, next) {}

    static async inviteOrganizationAccept(req, res, next) {}

    static async inviteOrganizationReject(req, res, next) {}


    static async requestOrganization(req, res, next) {}

    static async requestOrganizationAccept(req, res, next) {}

    static async requestOrganizationReject(req, res, next) {}


    // Read
    static async myOrganization(req, res, next) {}

    static async getAllOrganizations(req, res, next) {}

    static async getOrganization(req, res, next) {}

    static async getAnOrganizationsUsers(req, res, next) {}

    static async getAnOrganizationsUserInvites(req, res, next) {}

    static async getAnOrganizationsUserRequests(req, res, next) {}

    // Update
    static async updateOrganization(req, res, next) {}

    // Delete
    static async removeOrganization(req, res, next) {}
}

export default OrganizationsController

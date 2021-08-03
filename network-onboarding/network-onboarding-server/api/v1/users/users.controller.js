import { rest } from 'blockapps-rest'

class UsersController {
    // Create
    static async createUser(req, res, next) {
        try {
            const { dapp, body } = req
            const result = await dapp.managers.usersManager.registerUser(body)
            rest.response.status200(res, result)
            return next()
        } catch (e) {
            return next(e)
        }
    }


    static async inviteUser(req, res, next) {}

    static async inviteUserAccept(req, res, next) {}

    static async inviteUserReject(req, res, next) {}


    static async requestUser(req, res, next) {}

    static async requestUserAccept(req, res, next) {}

    static async requestUserReject(req, res, next) {}


    // Read
    static async myUser(req, res, next) {}

    static async getUser(req, res, next) {}

    // Update
    static async updateUser(req, res, next) {}

    // Delete
    static async removeUser(req, res, next) {}
}

export default UsersController

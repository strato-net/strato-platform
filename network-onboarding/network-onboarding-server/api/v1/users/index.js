import express from 'express'
import AuthHandler from '../../middleware/authHandler'
import loadDapps from '../../middleware/loadDappHandler'
import { Users } from '../endpoints'
import UsersController from './users.controller'

const router = express.Router()

// Actions are performed on the route in the order of the arguments
// Create
router.put(
    Users.create,
    AuthHandler.authorizeRequest(), 
    loadDapps, 
    UsersController.createUser
)
router.put(
    Users.invite,
    AuthHandler.authorizeRequest(), 
    loadDapps, 
    UsersController.inviteUser
)
router.put(
    Users.request,
    AuthHandler.authorizeRequest(), 
    loadDapps, 
    UsersController.requestUser
)

// Read
router.get(
    Users.me,
    AuthHandler.authorizeRequest(),
    loadDapps,
    UsersController.myUser
)
router.get(
    Users.get,
    AuthHandler.authorizeRequest(),
    loadDapps,
    UsersController.getUser
)

// Update
router.put(
    Users.update,
    AuthHandler.authorizeRequest(),
    loadDapps,
    UsersController.updateUser
)

// Delete
router.delete(
    Users.remove,
    AuthHandler.authorizeRequest(),
    loadDapps,
    UsersController.removeUser
)

export default router

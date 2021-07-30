import express from 'express'
import AuthHandler from '../../middleware/authHandler'
import loadDapps from '../../middleware/loadDappHandler'
import { Organizations } from '../endpoints'
import OrganizationsController from './organizations.controller'

const router = express.Router()

// Actions are performed on the route in the order of the arguments
// Create
router.put(
    Organizations.create,
    AuthHandler.authorizeRequest(), 
    loadDapps, 
    OrganizationsController.createOrganization
)
router.put(
    Organizations.invite,
    AuthHandler.authorizeRequest(), 
    loadDapps, 
    OrganizationsController.inviteOrganization
)
router.put(
    Organizations.request,
    AuthHandler.authorizeRequest(), 
    loadDapps, 
    OrganizationsController.requestOrganization
)

// Read
router.get(
    Organizations.me,
    AuthHandler.authorizeRequest(),
    loadDapps,
    OrganizationsController.myOrganization
)
router.get(
    Organizations.getAll,
    AuthHandler.authorizeRequest(),
    loadDapps,
    OrganizationsController.getAllOrganizations
)
router.get(
    Organizations.get,
    AuthHandler.authorizeRequest(),
    loadDapps,
    OrganizationsController.getOrganization
)
router.get(
    Organizations.getUsers,
    AuthHandler.authorizeRequest(),
    loadDapps,
    OrganizationsController.getAnOrganizationsUsers
)
router.get(
    Organizations.getUserInvites,
    AuthHandler.authorizeRequest(),
    loadDapps,
    OrganizationsController.getAnOrganizationsUserInvites
)
router.get(
    Organizations.getUserRequests,
    AuthHandler.authorizeRequest(),
    loadDapps,
    OrganizationsController.getAnOrganizationsUserRequests
)

// Update
router.put(
    Organizations.update,
    AuthHandler.authorizeRequest(),
    loadDapps,
    OrganizationsController.updateOrganization
)

// Delete
router.delete(
    Organizations.remove,
    AuthHandler.authorizeRequest(),
    loadDapps,
    OrganizationsController.removeOrganization
)

export default router

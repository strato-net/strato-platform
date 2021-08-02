import express from 'express'
import AuthHandler from '../../middleware/authHandler'
import loadDapps from '../../middleware/loadDappHandler'
import { Applications } from '../endpoints'
import ApplicationsController from './applications.controller'

const router = express.Router()

// Actions are performed on the route in the order of the arguments
// Create
router.put(
    Applications.create,
    AuthHandler.authorizeRequest(), 
    loadDapps, 
    ApplicationsController.createApplication
)

// Read - Nothing to read?

// Update
// Update/CRUD to applications's organizations list -- address = app's address
// Create for orgs
router.put(
    Applications.addOrganization,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.addOrganizationToApplication
)

router.put(
    Applications.inviteOrganization,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.inviteOrganizationToApplication
)
router.put(
    Applications.inviteOrganizationAccept,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.inviteOrganizationToApplicationAccept
)
router.put(
    Applications.inviteOrganizationReject,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.inviteOrganizationToApplicationReject
)

router.put(
    Applications.requestOrganization,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.requestOrganizationToApplication
)
router.put(
    Applications.requestOrganizationAccept,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.requestOrganizationToApplicationAccept
)
router.put(
    Applications.requestOrganizationReject,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.requestOrganizationToApplicationReject
)

router.put(
    Applications.getOrganizations,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.getOrganizations
)
router.put(
    Applications.getOrganizationInvites,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.getOrganizationInvites
)
router.put(
    Applications.getOrganizationRequests,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.getOrganizationRequests
)

router.put(
    Applications.removeOrgfromApp,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.removeOrganizationFromApplication
)


// Delete
router.delete(
    Applications.remove,
    AuthHandler.authorizeRequest(),
    loadDapps,
    ApplicationsController.removeOrganization
)

export default router

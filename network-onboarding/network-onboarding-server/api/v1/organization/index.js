import express from 'express'
import AuthHandler from '../../middleware/authHandler'
import loadDapps from '../../middleware/loadDappHandler'
import { Organizations } from '../endpoints'
import OrganizationController from './organization.controller'

const router = express.Router()

router.get(Organizations.getAll, AuthHandler.authorizeRequest(), loadDapps, OrganizationController.getAll)
router.put(Organizations.update, AuthHandler.authorizeRequest(), loadDapps, OrganizationController.updateOrganization)

export default router

import express from 'express'
import { SellerStatus } from '../endpoints'
import SellerStatusController from './sellerStatus.controller'
import authHandler from '../../middleware/authHandler'
import loadDapp from '../../middleware/loadDappHandler'

const router = express.Router()

router.post(
  SellerStatus.requestReview,
  authHandler.authorizeRequest(),
  loadDapp,
  SellerStatusController.requestReview,
)

router.post(
  SellerStatus.authorizeSeller,
  authHandler.authorizeRequest(),
  loadDapp,
  SellerStatusController.authorizeSeller
)

router.post(
    SellerStatus.deauthorizeSeller,
    authHandler.authorizeRequest(),
    loadDapp,
    SellerStatusController.deauthorizeSeller
  )
  
export default router

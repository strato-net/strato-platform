import express from "express"
import dayjs from "dayjs"
import * as packageJson from "../../package.json"
import { deployParamName } from "../../helpers/constants"

import category from './Category'
import product from './Product'
import carbon from './Carbon';
import inventory from './Inventory'
import order from './Order'
import eventType from './EventType'
import event from './Event'
import authentication from './authentication'
import users from './users'
import image from './Image'
import marketplace from './Marketplace'
import paymentService from './PaymentService'
import orderLine from "./OrderLine"

import {
  Authentication,
  Users,
  Category,
  Product,
  Carbon,
  Inventory,
  Order,
  EventType,
  Event,
  Image,
  Marketplace,
  OrderLine,
  PaymentService,
} from './endpoints'


const router = express.Router()

router.use(Authentication.prefix, authentication)
router.use(Users.prefix, users)
router.use(Category.prefix, category)
router.use(Product.prefix, product)
router.use(Carbon.prefix, carbon)
router.use(Inventory.prefix, inventory)
router.use(Order.prefix, order)
router.use(EventType.prefix, eventType)
router.use(Event.prefix, event)
router.use(Image.prefix, image)
router.use(Marketplace.prefix, marketplace)
router.use(OrderLine.prefix, orderLine)
router.use(PaymentService.prefix, paymentService)


router.get(`/health`, (req, res) => {
  const deployment = req.app.get(deployParamName);
  res.json({
    name: packageJson.name,
    description: packageJson.description,
    version: packageJson.version,
    timestamp: dayjs().unix(),
    deployment
  });
});


export default router;

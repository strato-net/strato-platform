import express from "express"
import dayjs from "dayjs"
import * as packageJson from "../../package.json"
import { deployParamName } from "../../helpers/constants"

import category from './Category'
import subCategory from './SubCategory'
import product from './Product'
import inventory from './Inventory'
import item from './Item'
import art from './Art'
import carbon from './Carbon'
import metals from './Metals'
import clothing from './Clothing'
import membership from './Membership'
import collectibles from './Collectibles'
import order from './Order'
import orderLineItem from './OrderLineItem'
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
  SubCategory,
  Product,
  Inventory,
  Item,
  Art,
  Carbon,
  Metals,
  Clothing,
  Membership,
  Collectibles,
  Order,
  OrderLineItem,
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
router.use(SubCategory.prefix, subCategory)
router.use(Product.prefix, product)
router.use(Inventory.prefix, inventory)
router.use(Item.prefix, item)
router.use(Art.prefix, art)
router.use(Carbon.prefix, carbon)
router.use(Clothing.prefix, clothing)
router.use(Membership.prefix, membership)
router.use(Collectibles.prefix, collectibles)
router.use(Metals.prefix, metals)
router.use(Order.prefix, order)
router.use(OrderLineItem.prefix, orderLineItem)
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

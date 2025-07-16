import express from 'express';
import dayjs from 'dayjs';
import * as packageJson from '../../package.json';
import { deployParamName } from '../../helpers/constants';

import category from './Category';
import subCategory from './SubCategory';
import product from './Product';
import inventory from './Inventory';
import item from './Item';
import art from './Art';
import tokens from './Tokens';
import carbonOffset from './CarbonOffset';
import metals from './Metals';
import spirits from './Spirits';
import clothing from './Clothing';
import membership from './Membership';
import carbonDAO from './CarbonDAO';
import collectibles from './Collectibles';
import order from './Order';
import authentication from './authentication';
import issuerStatus from './IssuerStatus';
import users from './users';
import marketplace from './Marketplace';
import paymentService from './PaymentService';
import userActivity from './UserActivity';
import redemption from './Redemption';
import transaction from './Transactions';
import reserve from './Reserve';
import escrow from './Escrow';

import {
  Authentication,
  IssuerStatus,
  Users,
  Category,
  SubCategory,
  Product,
  Inventory,
  Item,
  Art,
  Tokens,
  CarbonOffset,
  Metals,
  Spirits,
  Clothing,
  Membership,
  CarbonDAO,
  Collectibles,
  Order,
  Marketplace,
  PaymentService,
  UserActivity,
  Redemption,
  Transaction,
  Reserve,
  Escrow,
  Eth,
} from './endpoints';

const router = express.Router();

router.use(Authentication.prefix, authentication);
router.use(IssuerStatus.prefix, issuerStatus);
router.use(Users.prefix, users);
router.use(Category.prefix, category);
router.use(SubCategory.prefix, subCategory);
router.use(Product.prefix, product);
router.use(Inventory.prefix, inventory);
router.use(Item.prefix, item);
router.use(Art.prefix, art);
router.use(Tokens.prefix, tokens);
router.use(CarbonOffset.prefix, carbonOffset);
router.use(Clothing.prefix, clothing);
router.use(Membership.prefix, membership);
router.use(CarbonDAO.prefix, carbonDAO);
router.use(Collectibles.prefix, collectibles);
router.use(Metals.prefix, metals);
router.use(Spirits.prefix, spirits);
router.use(Order.prefix, order);
router.use(Marketplace.prefix, marketplace);
router.use(PaymentService.prefix, paymentService);
router.use(UserActivity.prefix, userActivity);
router.use(Redemption.prefix, redemption);
router.use(Transaction.prefix, transaction);
router.use(Reserve.prefix, reserve);
router.use(Escrow.prefix, escrow);

router.get(`/health`, (req, res) => {
  const deployment = req.app.get(deployParamName);
  res.json({
    name: packageJson.name,
    description: packageJson.description,
    version: packageJson.version,
    timestamp: dayjs().unix(),
    deployment,
  });
});

export default router;

import { add } from 'winston';

export const Authentication = {
  prefix: '/authentication',
  callback: '/callback',
  logout: '/logout',
};

export const IssuerStatus = {
  prefix: '/issuerstatus',
  requestReview: '/requestReview',
  authorizeIssuer: '/authorizeIssuer',
  deauthorizeIssuer: '/deauthorizeIssuer',
  admin: '/admin',
};

export const Users = {
  prefix: '/users',
  me: '/me',
  get: '/:address',
  getAll: '',
};

export const Category = {
  prefix: '/category',
  get: '/:address/',
  getAll: '/',
  audit: '/:address/:chainId/audit',
  transferOwnership: '/transferOwnership',
};

export const SubCategory = {
  prefix: '/subcategory',
  get: '/:address/',
  getAll: '/',
  create: '/',
  update: '/update',
  audit: '/:address/:chainId/audit',
  transferOwnership: '/transferOwnership',
};

export const Product = {
  prefix: '/product',
  get: '/:address',
  getAll: '/',
  getAllProductNames: '/filter/names',
  create: '/',
  update: '/update',
  delete: '/delete',
  // audit: '/:address/:chainId/audit',
  // transferOwnership: '/transferOwnership'
};

export const Inventory = {
  prefix: '/inventory',
  transferredItems: '/transfers/items/',
  getOwnershipHistory: '/ownership/history',
  get: '/:address',
  getAll: '/',
  getAllUserInventories: '/user/inventories/',
  create: '/',
  update: '/update',
  list: '/list',
  unlist: '/unlist',
  resell: '/resell',
  transfer: '/transfer',
  supportedTokens: '/supportedTokens',
  bridge: '/bridge',
  updateSale: '/updateSale',
  getPriceHistory: '/price/history',
};

export const Redemption = {
  prefix: '/redemption',
  get: '/:id',
  create: '/',
  getRedemptionServices: '/services',
  getOutgoingRedemptionRequests: '/outgoing',
  getIncomingRedemptionRequests: '/incoming',
  close: '/close',
};

export const Transaction = {
  prefix: '/transaction',
  getUser: '/user',
  getGlobal: '/global',
};

export const Item = {
  prefix: '/item',
  ownershipHistory: '/ownership/:address',
  get: '/:address/:chainId/',
  getAll: '/',
  create: '/',
  update: '/update',
  audit: '/:address/:chainId/audit',
  transferOwnership: '/transferOwnership',
  transfers: '/transfers',
  getRawMaterials: '/rawmaterials',
};

export const Art = {
  prefix: '/art',
  getAll: '/',
  create: '/',
};

export const Tokens = {
  prefix: '/tokens',
  create: '/',
  getETHSTAddress: '/address',
  addHash: '/addHash',
};

export const CarbonOffset = {
  prefix: '/carbonOffset',
  getAll: '/',
  create: '/',
};

export const Metals = {
  prefix: '/metals',
  getAll: '/',
  create: '/',
};

export const Spirits = {
  prefix: '/spirits',
  getAll: '/',
  create: '/',
};

export const Clothing = {
  prefix: '/clothing',
  getAll: '/',
  create: '/',
};

export const Membership = {
  prefix: '/membership',
  getAll: '/',
  create: '/',
};

export const CarbonDAO = {
  prefix: '/carbonDAO',
  getAll: '/',
  create: '/',
};

export const Collectibles = {
  prefix: '/collectibles',
  getAll: '/',
  create: '/',
};

export const Order = {
  prefix: '/order',
  get: '/:address',
  getAll: '/',
  create: '/',
  payment: '/payment',
  userAddress: '/userAddress',
  getAllUserAddress: '/userAddresses/user/:redemptionService?',
  getUserAddress: '/userAddress/:redemptionService/:shippingAddressId',
  cancelSaleOrder: '/sale/cancel',
  checkSaleQuantity: '/saleQuantity',
  executeSale: '/closeSale',
  waitForOrderEvent: '/wait/event',
  updateOrderComment: '/updateComment',
  export: '/exportOrders',
};

export const Marketplace = {
  prefix: '/marketplace',
  getAll: '/',
  getAllLoggedIn: '/all',
  getTopSellingProducts: '/topselling',
  getTopSellingProductsLoggedIn: '/user/topselling',
  getUSDSTBalance: '/USDST',
  getCataBalance: '/cata',
  getUSDSTAddress: '/USDST/address',
  getCataAddress: '/cata/address',
  getStratsAddress: '/strats/address',
  getStakeableProducts: '/stake',
  get18DecimalPlaces: '/18DecimalPlaces',
};

export const PaymentService = {
  prefix: '/payment',
  getAll: '/',
  getNotOnboarded: '/onboarding',
};

export const UserActivity = {
  prefix: '/userActivity',
  getAll: '/',
};

export const Reserve = {
  prefix: '/reserve',
  get: '/:address',
  getAll: '/',
  oraclePrice: '/oraclePrice/:address',
  stake: '/stake',
  unstake: '/unstake',
  borrow: '/borrow',
  repay: '/repay',
};

export const Escrow = {
  prefix: '/escrow',
  getEscrowForAsset: '/:assetRootAddress',
  getCataRewards: '/reward',
};

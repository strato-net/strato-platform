export const Authentication = {
  prefix: '/authentication',
  callback: '/callback',
  logout: '/logout',
}

export const Users = {
  prefix: '/users',
  me: '/me',
  get: '/:address',
  getAll: '',
}

export const Category = {
  prefix: '/category',
  get: '/:address/',
  getAll: '/',
  audit: '/:address/:chainId/audit',
  transferOwnership: '/transferOwnership',
}

export const SubCategory = {
  prefix: '/subcategory',
  get: '/:address/',
  getAll: '/',
  create: '/',
  update: '/update',
  audit: '/:address/:chainId/audit',
  transferOwnership: '/transferOwnership',
}

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
}

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
  updateSale: '/updateSale',
  // audit: '/:address/:chainId/audit',
}

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
  getRawMaterials: '/rawmaterials'
}

export const Art = {
  prefix: '/art',
  getAll: '/',
  create: '/'
}

export const CarbonOffset = {
  prefix: '/carbonOffset',
  getAll: '/',
  create: '/'
}

export const Metals = {
  prefix: '/metals',
  getAll: '/',
  create: '/'
}

export const Clothing = {
  prefix: '/clothing',
  getAll: '/',
  create: '/'
}

export const Membership = {
  prefix: '/membership',
  getAll: '/',
  create: '/'
}

export const CarbonDAO = {
  prefix: '/carbonDAO',
  getAll: '/',
  create: '/'
}

export const Collectibles = {
  prefix: '/collectibles',
  getAll: '/',
  create: '/'
}

export const Order = {
  prefix: '/order',
  get: '/:address',
  getAll: '/',
  create: '/',
  updateOrderStatus: '/update',
  updateBuyerDetails: '/updateBuyerDetails',
  updateSellerDetails: '/updateSellerDetails',
  payment: '/payment',
  paymentSession: '/payment/session/:session_id/:sellersCommonName',
  paymentIntent: '/payment/intent/:session_id/:sellersCommonName',
  userAddress: '/userAddress',
  getAllUserAddress: '/userAddresses/user',
  getAddressFromId: '/userAddress/:id',
  createSaleOrder: '/sale',
  cancelSaleOrder: '/sale/cancel',
  executeSale: '/closeSale',
  updateOrderComment: '/updateComment',
  export: '/exportOrders',
  activity: '/activity'
}

export const OrderLine = {
  prefix: '/orderLine',
  get: '/:address'
}

export const OrderLineItem = {
  prefix: '/orderLineItem',
  get: '/:orderLineId',
  getAll: '/',
  create: '/',
  update: '/update',
  audit: '/:address/:chainId/audit',
  transferOwnership: '/transferOwnership',
}

export const EventType = {
  prefix: '/eventType',
  getAll: '/',
  create: '/'
}

export const Event = {
  prefix: '/event',
  getInventoryEventTypes: '/:inventoryId',
  getInventoryEventTypeDetails: '/:inventoryId/:eventTypeId',
  getAll: '/',
  create: '/',
  certifyEvent: '/update',
  audit: '/:address/:chainId/audit',
  transferOwnership: '/transferOwnership',
}

export const Marketplace = {
  prefix: '/marketplace',
  getAll: '/',
  getAllLoggedIn: '/all',
  getTopSellingProducts: '/topselling',
  getTopSellingProductsLoggedIn: '/user/topselling',
  getStratsBalance: '/strats'
}

export const PaymentService = {
  prefix: '/payment',
  stripeOnboarding: '/stripe/account',
  stripeConnectStatus: '/stripe/account/status/:ownerCommonName',
  stripeWebhook: '/stripe/webhook',
  stripeWebhookConnect: '/stripe/webhook/connect',
}



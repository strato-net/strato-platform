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
  get: '/:address',
  getAll: '/',
  create: '/',
  update: '/update',
  retire: '/retire'
  // audit: '/:address/:chainId/audit',
  // transferOwnership: '/transferOwnership',
}

export const Order = {
  prefix: '/order',
  get: '/:address',
  getAll: '/',
  create: '/',
  update: '/update',
  updateBuyerDetails: '/updateBuyerDetails',
  updateSellerDetails: '/updateSellerDetails',
  payment: '/payment',
  paymentSession: '/payment/session/:session_id',
  userAddress: '/userAddress',
  getAllUserAddress: '/userAddresses/user',
}

export const OrderLine = {
  prefix: '/orderLine',
  get: '/:address'
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

export const Image = {
  prefix: '/image',
  upload: '/',
  update: '/:fileKey',
}

export const Marketplace = {
  prefix: '/marketplace',
  getAll: '/',
  getAllLoggedIn: '/all',
  getTopSellingProducts: '/topselling',
  getTopSellingProductsLoggedIn: '/user/topselling'
}

export const PaymentService = {
  prefix: '/payment',
  stripeOnboarding: '/stripe/account',
  stripeConnectStatus: '/stripe/account/status/:ownerOrganization',
  stripeWebhook: '/stripe/webhook',
  stripeWebhookConnect: '/stripe/webhook/connect',
}



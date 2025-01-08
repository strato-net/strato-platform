// eslint-disable-next-line import/no-anonymous-default-export
export default {
  Marketplace: { label: 'Marketplace', url: '/' },
  MarketplaceProductList: {
    label: 'Marketplace Product List',
    url: '/category',
  },
  MarketplaceCategoryProductList: {
    label: 'Marketplace Product List',
    url: '/c/:category',
  },
  MarketplaceUserProfile: {
    label: 'Marketplace User Profile',
    url: '/profile/:commonName',
  },
  MarketplaceProductDetail: {
    label: 'Marketplace Product Detail',
    url: '/dp/:address/:name',
  },
  EthstProductDetail: { label: 'ETHST Product Detail', url: '/ethst/:address' },
  LoginRedirect: { label: 'LoginRedirect', url: '/login' },
  Checkout: { label: 'Checkout', url: '/checkout' },
  ConfirmOrder: { label: 'Confirm Order', url: '/confirmOrder' },
  Products: { label: 'Product', url: '/products' },
  ProductDetail: { label: 'Product Detail', url: '/products/:id' },
  MyWallet: { label: 'Inventory', url: '/mywallet' },
  MyWalletStakeable: { label: 'Inventory Stakeable', url: '/mywallet?st=true' },
  Stake: { label: 'Stake', url: '/stake' },
  InventoryDetail: { label: 'Inventory Detail', url: '/inventories/:id/:name' },
  VaultDetail: { label: 'Vault Detail', url: '/vaults/:address' },
  Items: { label: 'Item', url: '/items' },
  Orders: { label: 'Order', url: '/order/:type' },
  Transactions: { label: 'Transactions', url: '/transactions' },
  ActivityFeed: {
    label: 'Activity Feed',
    url: '/activityFeed',
  },
  RedemptionsOutgoingDetails: {
    label: 'Redemption Outgoing Detail',
    url: '/redemptions-outgoing/:redemptionService/:id',
  },
  RedemptionsIncomingDetails: {
    label: 'Redemption Incoming Detail',
    url: '/redemptions-incoming/:redemptionService/:id',
  },
  SoldOrderDetails: { label: 'Sold Order Detail', url: '/sold-orders/:id' },
  BoughtOrderDetails: {
    label: 'Bought Order Detail',
    url: '/bought-orders/:id',
  },
  Transfers: {
    label: 'Transfers',
    url: '/order/transfers',
  },
  SoldOrderItemDetail: {
    label: 'Order Item Detail',
    url: '/sold-orders-details/:id',
  },
  BoughtOrderItemDetail: {
    label: 'Order Item Detail',
    url: '/bought-orders-details/:id',
  },
  Admin: { label: 'Admin ', url: '/admin' },
  ProcessingOrder: { label: 'Processing Order', url: '/order/status' },
  Invoice: { label: 'Invoice', url: '/orders/invoice/:id' },
  Error: { label: 'Error', url: '/404' },
  FAQ: { label: 'FAQ', url: '/frequently-asked-questions' },
};

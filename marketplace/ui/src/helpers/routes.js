

// eslint-disable-next-line import/no-anonymous-default-export
export default {
  Sitemap: { label: "Site Map", url: "/sitemap" },
  Certifier: { label: "Certifier", url: "/certifier" },
  Marketplace: { label: "Marketplace", url: "/" },
  MarketplaceProductList: {
    label: "Marketplace Product List",
    url: "/category",
  },
  MarketplaceCategoryProductList: {
    label: "Marketplace Product List",
    url: "/c/:category",
  },
  MarketplaceUserProfile: {
    label: "Marketplace User Profile",
    url: "/profile/:commonName",
  },
  MarketplaceProductDetail: {
    label: "Marketplace Product Detail",
    url: "/dp/:address/:name",
  },
  LoginRedirect: { label: "LoginRedirect", url: "/login" },
  Checkout: { label: "Checkout", url: "/checkout" },
  ConfirmOrder: { label: "Confirm Order", url: "/confirmOrder" },
  Products: { label: "Product", url: "/products" },
  ProductDetail: { label: "Product Detail", url: "/products/:id" },
  MyStore: { label: "Inventory", url: "/mystore" },
  InventoryDetail: { label: "Inventory Detail", url: "/inventories/:id/:name" },
  InventoryEventSerialNumberList: { label: "Inventory Event Serial Numbers", url: "/inventories/events/serialNumbers" },
  Items: { label: "Item", url: "/items" },
  Orders: { label: "Order", url: "/order/:type" },
  SoldOrderDetails: { label: "Sold Order Detail", url: "/sold-orders/:id" },
  BoughtOrderDetails: {
    label: "Bought Order Detail",
    url: "/bought-orders/:id",
  },
  Transfers: {
    label: "Transfers",
    url: "/order/transfers",
  },
  SoldOrderItemDetail: {
    label: "Order Item Detail",
    url: "/sold-orders-details/:id",
  },
  BoughtOrderItemDetail: {
    label: "Order Item Detail",
    url: "/bought-orders-details/:id",
  },
  OrderItemEventsList: {
    label: "Order Item Event List",
    url: "/orders/events/:itemId",
  },
  Events: { label: "Event", url: "/events" },
  EventDetail: { label: "Event Detail", url: "/events/:id" },
  EventList: { label: "Event List", url: "/inventories/events/:id" },
  InventoryEventDetail: {
    label: "Event Detail",
    url: "/inventories/events/:inventoryId/:eventTypeId",
  },
  Admin: { label: "Admin ", url: "/admin" },
  EventSerialNumberList: { label: "Event Serial Numbers", url: "/events/serialNumbers" },
  ProcessingOrder: { label: "Processing Order", url: "/order/status" },
  Invoice: { label: "Invoice", url: "/orders/invoice/:id" },
  OnboardingSellerToStripe: { label: "Onboarding Seller to Stripe", url: "/inventories/stripe/onboarding" },
};

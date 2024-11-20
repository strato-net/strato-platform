const zeroAddress = ''.padStart(40, '0');
const factory = {
  getCreateOrderArgs(uid, buyerOrganization = '', inventories = []) {
    const args = {
      buyerOrganization,
      orderList: inventories.map((inventory) => ({
        inventoryId: inventory,
        quantity: 2,
      })),
      orderTotal: 40,
      shippingAddress: '0000000000000000000000000000000000000000',
    };
    return args;
  },

  getCreatePaymentArgs(
    uid,
    buyerOrganization = '',
    inventories = [],
    userAddress
  ) {
    const args = {
      buyerOrganization,
      orderList: inventories.map((inventory) => ({
        inventoryId: inventory,
        quantity: 2,
      })),
      orderTotal: 40,
      shippingAddress: userAddress,
    };
    return args;
  },

  getUserAddressArgs(uid) {
    const args = {
      shippingName: `name_${uid}`,
      shippingZipcode: `${uid}`,
      shippingState: `state_${uid}`,
      shippingCity: `city_${uid}`,
      shippingAddressLine1: `addressLine1_${uid}`,
      shippingAddressLine2: `addressLine2_${uid}`,
      billingName: `name_${uid}`,
      billingZipcode: `${uid}`,
      billingState: `state_${uid}`,
      billingCity: `city_${uid}`,
      billingAddressLine1: `addressLine1_${uid}`,
      billingAddressLine2: `addressLine2_${uid}`,
    };
    return args;
  },

  paymentUrlDomain: 'https://checkout.stripe.com/c/pay/',

  getCreatePaymentArgs(
    uid,
    buyerOrganization = '',
    inventories = [],
    userAddress
  ) {
    const args = {
      buyerOrganization,
      orderList: inventories.map((inventory) => ({
        inventoryId: inventory,
        quantity: 2,
      })),
      orderTotal: 40,
      shippingAddress: userAddress,
    };
    return args;
  },

  getUserAddressArgs(uid) {
    const args = {
      shippingName: `name_${uid}`,
      shippingZipcode: `${uid}`,
      shippingState: `state_${uid}`,
      shippingCity: `city_${uid}`,
      shippingAddressLine1: `addressLine1_${uid}`,
      shippingAddressLine2: `addressLine2_${uid}`,
      billingName: `name_${uid}`,
      billingZipcode: `${uid}`,
      billingState: `state_${uid}`,
      billingCity: `city_${uid}`,
      billingAddressLine1: `addressLine1_${uid}`,
      billingAddressLine2: `addressLine2_${uid}`,
    };
    return args;
  },

  getCreateUserAddressArgs(uid) {
    const args = {
      shippingName: `name_${uid}`,
      shippingZipcode: `${uid}`,
      shippingState: `state_${uid}`,
      shippingCity: `city_${uid}`,
      shippingAddressLine1: `addressLine1_${uid}`,
      shippingAddressLine2: `addressLine2_${uid}`,
      billingName: `name_${uid}`,
      billingZipcode: `${uid}`,
      billingState: `state_${uid}`,
      billingCity: `city_${uid}`,
      billingAddressLine1: `addressLine1_${uid}`,
      billingAddressLine2: `addressLine2_${uid}`,
    };
    return args;
  },
};

export default factory;

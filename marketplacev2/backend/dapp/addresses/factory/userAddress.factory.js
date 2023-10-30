/** Factory creation for UserAddress arguments. */
const factory = {
    /** Sample arguments for creating a UserAddress contract. Use util.uid() to generate a uid. */
    getUserAddressArgs(uid) {
        const args = {
            appChainId: `${uid}`,
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
            createdDate: new Date().getTime(),
        };
        return args;
    },
};

export default factory;

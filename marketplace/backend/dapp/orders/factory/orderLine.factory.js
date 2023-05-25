
import constants from "/helpers/constants";
/** Factory creation for OrderLine arguments. */
const factory = {
    /** Sample arguments for creating a OrderLine contract. Use util.uid() to generate a uid. */
    getOrderLineArgs(uid) {
        const args = {
            productId: constants.zeroAddress,
            inventoryId: constants.zeroAddress,
            quantity: uid,
            pricePerUnit: uid,
            tax: uid,
            shippingCharges: uid,
            createdDate: new Date().getTime(),
            orderAddress:constants.zeroAddress
        };
        return args;
    },
    getOrderLineItemsArgs(uid) {
        const args = {
            orderLineId: constants.zeroAddress,
            items: Array(4).fill(`${constants.zeroAddress}`),
            createdDate: new Date().getTime(),
        };
        return args;
    },
};
export default factory;
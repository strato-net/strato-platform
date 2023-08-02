
import constants from "/helpers/constants";
/** Factory creation for OrderLine arguments. */
const factory = {
    /** Sample arguments for creating a OrderLine contract. Use util.uid() to generate a uid. */
    getOrderLineArgs(uid) {
        const args = {
            productId: constants.zeroAddress,
            inventoryId: constants.zeroAddress,
            creditBatchSerialization: "Test123",
            quantity: uid,
            pricePerUnit: uid,
            tax: uid,
            createdDate: new Date().getTime(),
            orderAddress:constants.zeroAddress
        };
        return args;
    },
};
export default factory;
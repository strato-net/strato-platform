import constants from "/helpers/constants";
/** Factory creation for OrderLineItem arguments. */
const factory = {
    /** Sample arguments for creating a OrderLineItem contract. Use util.uid() to generate a uid. */
    getOrderLineItemArgs(uid) {
        const args = {
            orderLineId: constants.zeroAddress,
            itemId: `itemId_${uid}`,
            itemSerialNumber: `itemSerialNumber_${uid}`,
            createdDate: new Date().getTime(),
        };
        return args;
    },
};

export default factory;

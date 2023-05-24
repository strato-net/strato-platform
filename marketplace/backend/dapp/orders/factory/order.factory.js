
import constants from "/helpers/constants";
/** Factory creation for Order arguments. */
const factory = {
    /** Sample arguments for creating a Order contract. Use util.uid() to generate a uid. */
    getOrderArgs(uid, buyerOrganization = "", sellerOrganization = "") {
        const args = {
            orderId: `${uid}`,
            buyerOrganization,
            sellerOrganization,
            orderDate: new Date().getTime(),
            orderTotal: uid,
            orderShippingCharges: uid,
            status: 1,
            amountPaid: uid,
            buyerComments: `buyerComments_${uid}`,
            sellerComments: `sellerComments_${uid}`,
            createdDate: new Date().getTime(),
            paymentSessionId: `paymentSessionId_${uid}`,
            shippingAddress: constants.zeroAddress
        };
        return args;
    },

    getUpdateBuyerOrderArgs(uid) {
        const args = {
            status: 2,
            buyerComments: `buyerComments_${uid}`,
        }
        return args;
    },

    getUpdateSellerOrderArgs(uid) {
        const args = {
            status: 2,
            fullfilmentDate: new Date().getTime(),
            sellerComments: `sellerComments_${uid}`,
        }
        return args;
    },

    getOrderLineArgs(uid) {
        const args = {
            orderChainId: constants.zeroAddress,
            inventoryOwner: constants.zeroAddress,
            productId: constants.zeroAddress,
            inventoryId: constants.zeroAddress,
            quantity: uid,
            pricePerUnit: uid,
            tax: uid,
            shippingCharges: uid,
            createdDate: new Date().getTime(),
        };
        return args;
    },

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

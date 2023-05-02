/** Factory creation for Event arguments. */
const factory = {
    /** Sample arguments for creating a Event contract. Use util.uid() to generate a uid. */
    getEventArgs(uid) {
        const args = {
            appChainId: `${uid}`,
            eventTypeId: `eventTypeId_${uid}`,
            itemSerialNumber: `itemSerialNumber_${uid}`,
            itemNFTAddress: `itemNFTAddress_${uid}`,
            date: `date_${uid}`,
            inventoryId: `inventoryId_${uid}`,
            productId: `productId_${uid}`,
            summary: `summary_${uid}`,
            certifiedBy: `certifiedBy_${uid}`,
            certifiedDate: `certifiedDate_${uid}`,
            createdAt: `createdAt_${uid}`,
        };
        return args;
    },
};

export default factory;

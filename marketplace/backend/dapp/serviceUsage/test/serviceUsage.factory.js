/** Factory creation for ServiceUsage arguments. */
const factory = {
    /** Sample arguments for creating a ServiceUsage contract. Use util.uid() to generate a uid. */
    getServiceUsageArgs(uid) {
        const args = {
            createdDate: uid,
            itemId: `${uid + 2}`.padStart(40, '0'),  // chainID
            serviceId: `${uid + 2}`.padStart(40, '0'),  // chainID
            serviceDate: uid,
            summary: `summary_${uid}`,
            status: 1,
            paymentStatus: 1,
            providerLastUpdated: `${uid + 2}`.padStart(40, '0'),
            providerComment: `providerComment_${uid}`,
            providerLastUpdatedDate: uid,
            pricePaid: uid,
        };
        return args;
    },
    getServiceUsageUpdateArgs(uid) {
        const args = {
            serviceDate: uid,
            summary: `summary_${uid}`,
            status: 2,
            paymentStatus: 2,
            providerLastUpdated: `${uid + 2}`.padStart(40, '0'),
            providerComment: `providerComment_${uid}`,
            providerLastUpdatedDate: uid,
            pricePaid: uid,
        };
        return args;
    },
};

export default factory;

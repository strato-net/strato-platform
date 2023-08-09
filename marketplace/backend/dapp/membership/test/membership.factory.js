/** Factory creation for Membership arguments. */
const factory = {
    /** Sample arguments for creating a Membership contract. Use util.uid() to generate a uid. */
    getMembershipArgs(uid) {
        const args = {
            productId: `${uid + 2}`.padStart(40, '0'),  // chainID
            timePeriodInMonths: uid,
            additionalInfo: `additionalInfo_${uid}`,
            createdDate: uid,
        };
        return args;
    },
};

export default factory;

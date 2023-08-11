/** Factory creation for MembershipService arguments. */
const factory = {
    /** Sample arguments for creating a MembershipService contract. Use util.uid() to generate a uid. */
    getMembershipServiceArgs(uid) {
        const args = {
            membershipId: `${uid + 2}`.padStart(40, '0'), 
            serviceId: `${uid + 2}`.padStart(40, '0'), 
            membershipPrice: uid,
            discountPrice: uid,
            maxQuantity: uid,
            createdDate: uid,
            isActive: true,
        };
        return args;
    },
};

export default factory;

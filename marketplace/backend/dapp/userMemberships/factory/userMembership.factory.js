/** Factory creation for UserMembership arguments. */
const factory = {
    /** Sample arguments for creating a UserMembership contract. Use util.uid() to generate a uid. */
    getUserMembershipArgs(uid, userAddress) {
        const args = {
            appChainId: `${uid}`,
            isAdmin: false,
            isTradingEntity: true,
            isCertifier: false,
            userAddress,
            owner: userAddress
        };
        return args;
    }
};

export default factory;



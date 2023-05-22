/** Factory creation for UserMembershipRequest arguments. */
const factory = {
    /** Sample arguments for creating a UserMembershipRequest contract. Use util.uid() to generate a uid. */
    getUserMembershipRequestArgs(uid, userAddress) {
        const args = {
            userAddress,
            userMembershipAddress: userAddress,
            state: 1,
            role: 1,
            createdDate: Date.now(),
            owner: userAddress
        };
        return args;
    }
};

export default factory;

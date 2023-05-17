/** Factory creation for UserMembership arguments. */
const factory = {
    /** Sample arguments for creating a UserMembership contract. Use util.uid() to generate a uid. */
    getUserMembershipArgs(uid, userAddress) {
        const args = {
            isAdmin: false,
            isTradingEntity: false,
            isCertifier: false,
            userAddress
        };
        return args;
    },
    getUpdateUserMembershipArgs() {
        const args = {
            isAdmin: false,
            isTradingEntity: true,
            isCertifier: false,
        };
        return args;
    },
    getUserMembershipRequestArgs(uid,userAddress,userMembershipAddress){
        const args = {
            userAddress,
            userMembershipAddress,
            roles: [2],
            createdDate: Date.now(),
        };
        return args;
    },
    getUpdateUserMembershipRequestArgs(userMembershipRequestAddress){
        const args = {
            userMembershipRequestAddress,
            userMembershipEvent:1
        };
        return args;
    },
};

export default factory;

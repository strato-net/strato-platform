/** Factory creation for Service arguments. */
const factory = {
    /** Sample arguments for creating a Service contract. Use util.uid() to generate a uid. */
    getServiceArgs(uid) {
        const args = {
            appChainId: `${uid}`,
            name: `name_${uid}`,
            description: `description_${uid}`,
            price: uid,
            createdDate: uid,
        };
        return args;
    },
};

export default factory;

/** Factory creation for Category arguments. */
const factory = {
    /** Sample arguments for creating a Category contract. Use util.uid() to generate a uid. */
    getSubCategoryArgs(uid) {
        const args = {
            appChainId: `${uid}`,
            name: `name_${uid}`,
            description: `description_${uid}`,
            createdDate: 16730225965,
        };
        return args;
    }
};

export default factory;
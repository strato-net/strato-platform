/** Factory creation for Category arguments. */
const factory = {
    /** Sample arguments for creating a Category contract. Use util.uid() to generate a uid. */
    getCategoryArgs(uid) {
        const args = {
            appChainId: `${uid}`,
            name: `name_${uid}`,
            description: `description_${uid}`,
            imageKey:`1675078111777_seeds.jpg`,
            createdDate: 1673022591,
        };
        return args;
    },
    getUpdateCategoryArgs(uid){
        const args={
            appChainId: `${uid}`,
            name: `name_${uid}`,
            description: `description_${uid}`,
            imageKey:`1675078111777_seeds.jpg`
        }
        return args;
    },
    getSubCategoryArgs(uid) {
        const args = {
            name: `name_${uid}`,
            description: `description_${uid}`,
            createdDate: 16730225945,
        };
        return args;
    },
    getUpdateSubCategoryArgs(uid) {
        const args = {
            name: `name_${uid}`,
            description: `description_${uid}`,
        };
        return args;
    },
};

export default factory;

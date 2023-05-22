/** Factory creation for Category arguments. */
const factory = {
    /** Sample arguments for creating a Category contract. Use util.uid() to generate a uid. */
    getCategoryArgs(uid) {
        const args = {
            name: `name_${uid}`,
            description: `description_${uid}`,
            imageKey:`1675078111777_seeds.jpg`,
            createdDate: 1673022591,
        };
        return args;
    }
};

export default factory;

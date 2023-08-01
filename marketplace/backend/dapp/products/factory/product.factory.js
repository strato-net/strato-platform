import { util } from "blockapps-rest";
/** Factory creation for Product arguments. */
const factory = {
    /** Sample arguments for creating a Product contract. Use util.uid() to generate a uid. */
    getProductArgs(uid, userAddress) {
        const args = {
            productArgs: {
                name: `name_${uid}`,
                description: `description_${uid}`,
                imageKey: `imageKey_${uid}`,
                isActive: true,
                category: 'Carbon',
                createdDate: new Date().getTime(),
                owner: userAddress
            }
        }
        return args;
    },
    updateProductArgs(address, uid) {
        const args = {
            productAddress: address,
            updates: {
                description: `description_${uid}`,
                imageKey: `imageKey_${uid}`,
                isActive: false,
            }
        }

        return args
    }
};

export default factory;

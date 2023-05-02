import { util } from "blockapps-rest";
/** Factory creation for Product arguments. */
const factory = {
    /** Sample arguments for creating a Product contract. Use util.uid() to generate a uid. */
    getProductArgs(uid, userAddress) {
        const args = {
            productArgs: {
                appChainId: `${uid}`,
                name: `name_${uid}`,
                description: `description_${uid}`,
                manufacturer: `manufacturer_${uid}`,
                unitOfMeasurement: 1,
                userUniqueProductCode: `userUniqueProductCode_${uid}`,
                uniqueProductCode: parseInt(util.iuid()),
                leastSellableUnit: uid,
                imageKey: `imageKey_${uid}`,
                isActive: true,
                categoryId: '0000000000000000000000000000000000000000',
                subCategoryId: '0000000000000000000000000000000000000000',
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
                userUniqueProductCode: `userUniqueProductCode_${uid}`,
            }
        }

        return args
    }
};

export default factory;

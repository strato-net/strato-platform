import { util } from "blockapps-rest";
/** Factory creation for Item arguments. */
const factory = {
    /** Sample arguments for creating a Item contract. Use util.uid() to generate a uid. */
    getItemArgs(uid) {
        const args = {
            itemArgs: {
                appChainId: `${uid}`,
                productId: '0000000000000000000000000000000000000000',
                uniqueProductCode: parseInt(util.iuid()),
                inventoryId: '0000000000000000000000000000000000000000',
                serialNumber: `serialNumber_${uid}`,
                itemNumber: parseInt(util.iuid()),
                status: 2,
                comment: `comment_${uid}`,
                createdDate: new Date().getTime(),
                rawMaterialProductName: [`rawMaterialProductName_${uid}`],
                rawMaterialSerialNumber: [`rawMaterialSerialNumber_${uid}`],
                rawMaterialProductId: [`rawMaterialProductId_${uid}`]
            }
        };
        return args;
    },
    updateItemArgs(address, uid) {
        const args = {
            itemAddress: address,
            updates: {
                status: 1,
                comment: `comment_${uid}`
            }
        }

        return args
    }
};

export default factory;

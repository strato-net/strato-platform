import { util } from "blockapps-rest";
/** Factory creation for Item arguments. */
const factory = {
    /** Sample arguments for creating a Item contract. Use util.uid() to generate a uid. */
    getItemArgs(uid) {
        const args = {
            itemArgs: {
                productId: '0000000000000000000000000000000000000000',
                inventoryId: '0000000000000000000000000000000000000000',
                creditBatchSerialization: `serialNumber_${uid}`,
                status: 2,
                createdDate: new Date().getTime(),
            }
        };
        return args;
    },
    updateItemArgs(address, uid) {
        const args = {
            itemAddress: address,
            updates: {
                status: 1,
            }
        }

        return args
    }
};

export default factory;

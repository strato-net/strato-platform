import { util } from "blockapps-rest";
/** Factory creation for Item arguments. */
const factory = {
    /** Sample arguments for creating a Item contract. Use util.uid() to generate a uid. */
    getItemArgs(uid) {
        const args = {
            itemArgs: {
                productId: '0000000000000000000000000000000000000000',
                inventoryId: '0000000000000000000000000000000000000000',
                creditBatchSerialization: uid + 1,
                quantity: 10,
                status: 2,
                createdDate: new Date().getTime()
            }
        };
        return args;
    },
    getItemArgsNoSerialNumber(uid) {
        const args = {
            itemArgs: {
                productId:  '0000000000000000000000000000000000000000',
                inventoryId:  '0000000000000000000000000000000000000000',
                creditBatchSerialization: '',
                quantity: 10,
                status: 2,
                createdDate: new Date().getTime()
            }
        };
        return args;
    },
    updateItemArgs(address, uid) {
        const args = {
            itemsAddress: address,
            status: 1,
        }

        return args
    },
    getEventArgs(itemsAddress, certifierAddress, uid) {
        const args = {
            itemsAddress: itemsAddress,
            eventTypeId: '0000000000000000000000000000000000000000',
            eventBatchId: uid,
            date: uid,
            summary: `summary_${uid}`,
            certifier: certifierAddress,
            createdDate: new Date().getTime(),
        }

        return args;
    },

    certifyEventArgs(eventAddress, uid) {
        const args = {
            eventAddress: eventAddress,
            certifiedDate: new Date().getTime(),
            updates: {
                certifierComment: `new_comment_${uid}`,
            }
        }

        return args;
    }
};

export default factory;

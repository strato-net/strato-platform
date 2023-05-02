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
                itemObject: [...new Array(5)].map((d, i) => {
                    return {
                        serialNumber: uid + i,
                        itemNumber: parseInt(util.iuid() + i),
                        rawMaterialProductName: [`rawMaterialProductName_${uid + i}`],
                        rawMaterialSerialNumber: [`rawMaterialSerialNumber_${uid + i}`],
                        rawMaterialProductId: [`rawMaterialProductId_${uid + i}`]
                    }
                }),
                status: 2,
                comment: `comment_${uid}`,
                createdDate: new Date().getTime()
            }
        };
        return args;
    },
    updateItemArgs(address, uid) {
        const args = {
            itemsAddress: address,
            status: 1,
            comment: `new_comment_${uid}`
        }

        return args
    },
    getEventArgs(itemsAddress, certifierAddress, uid) {
        const args = {
            itemsAddress: itemsAddress,
            appChainId: `${uid}`,
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

import { util } from "blockapps-rest";
/** Factory creation for Product arguments. */
const factory = {
    /** Sample arguments for creating a Product from ProductManager Contract. Use util.uid() to generate a uid. */
    getProductArgs(uid) {
        const args = {
            productArgs: {
                name: `name_${uid}`,
                description: `description_${uid}`,
                imageKey: `imageKey_${uid}`,
                isActive: true,
                category: `0000000000000000000000000000000000000000`,
                createdDate: 1673251301,
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
    },
    /** Sample arguments for creating an Inventory from ProductManager Contract. Use util.uid() to generate a uid. */
    getInventoryArgs(uid) {
        const args = {
            // Number of serial numbers should match the quantity if they are provided.
            quantity: 2,
            pricePerUnit: uid,
            vintage: 0,
            serialNumbers: [`A1${uid}`, `A2${uid}`],
            status: 2,
            createdDate: 1673251301
        }

        return args;
    },
    getInventoryArgsWithNoSN(uid) {
        const args = {
            quantity: 3,
            pricePerUnit: uid,
            vintage: 0,
            serialNumbers: [],
            status: 2,
            createdDate: 1673251301
        }

        return args;
    },
    updateInventoryArgs(address, inventoryAddress, uid) {
        const args = {
            productAddress: address,
            inventory: inventoryAddress,
            updates: {
                pricePerUnit: uid,
                status: 1
            }
        }

        return args;
    },
    updateInventoriesQuantitiesArgs(inventoryAddress, _quantity) {
        const args = {
            inventories: [inventoryAddress],
            quantities: [_quantity],
            isReduce: true
        }

        return args;
    },
};

export default factory;

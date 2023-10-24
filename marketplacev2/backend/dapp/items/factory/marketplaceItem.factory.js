import { util } from "blockapps-rest";

/** Factory creation for MarketplaceItem arguments. */
const factory = {
    /** Sample arguments for creating a MarketplaceItem contract. Use util.uid() to generate a uid. */
    addMarketplaceItemArgs(userAddress, uid) {
        const args = {
            itemArgs: {
                owner: userAddress,
                productId: '0000000000000000000000000000000000000000',
                inventoryId: '0000000000000000000000000000000000000000',
                serialNumber: `serialNumber_${uid}`,
                comment: `comment_${uid}`,
                itemNumber: parseInt(util.iuid()),
                createdDate: new Date().getTime(),
                itemStatus: 2,
                uniqueProductCode: parseInt(util.iuid()),
                rawMaterialProductName: [`rawMaterialProductName_${uid}`],
                rawMaterialSerialNumber: [`rawMaterialSerialNumber_${uid}`],
                rawMaterialProductId: [`rawMaterialProductId_${uid}`],
                availableQuantity: 3,
                batchId: `batchId_${uid}`,
                category: 'Carbon',
                pricePerUnit: uid,
                quantity: 3,
                inventoryStatus: 2,
                subCategory: 'Carbon Credit',
                inventoryType: `inventoryType_${uid}`,
                name: `name_${uid}`,
                description: `description_${uid}`,
                manufacturer: `manufacturer_${uid}`,
                unitOfMeasurement: 1,
                userUniqueProductCode: `userUniqueProductCode_${uid}`,
                leastSellableUnit: uid,
                imageKey: `imageKey_${uid}`,
                isActive: true,
                isDeleted: false,
                isInventoryAvailable: true
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
    },
    updateProductArgs(address, uid) {
        const args = {
            itemAddress: address,
            updates: {
                description: `description_${uid}`,
                imageKey: `imageKey_${uid}`,
                isActive: false,
                userUniqueProductCode: `userUniqueProductCode_${uid}`,
            }
        }

        return args
    },
    updateInventoryArgs(address, uid) {
        const args = {
            itemAddress: address,
            updates: {
                pricePerUnit: uid,
                status: 1
            }
        }

        return args;
    }
};

export default factory;

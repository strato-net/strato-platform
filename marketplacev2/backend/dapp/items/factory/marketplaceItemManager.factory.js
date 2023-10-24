import { util } from "blockapps-rest";

/** Factory creation for MarketplaceItemManager function arguments. */
const factory = {
  /** Sample arguments for creating a Item contract. Use util.uid() to generate a uid. */
  addMarketplaceItemArgs(uid) {
      const args = {
          itemArgs: {
              productId: '0000000000000000000000000000000000000000',
              inventoryId: '0000000000000000000000000000000000000000',
              uniqueProductCode: parseInt(util.iuid()),
              itemObject: [...new Array(5)].map((d, i) => {
                  return {
                      itemNumber: parseInt(util.iuid() + i),
                      serialNumber: uid + i,
                      rawMaterialProductName: [`rawMaterialProductName_${uid + i}`],
                      rawMaterialProductId: [`rawMaterialProductId_${uid + i}`],
                      rawMaterialSerialNumber: [`rawMaterialSerialNumber_${uid + i}`]
                  }
              }),
              status: 2,
              comment: `comment_${uid}`,
              createdDate: new Date().getTime(),
              name: `name_${uid}`,
              description: `description_${uid}`,
              manufacturer: `manufacturer_${uid}`,
              unitOfMeasurement: 1,
              userUniqueProductCode: `userUniqueProductCode_${uid}`,
              leastSellableUnit: uid,
              imageKey: `imageKey_${uid}`,
              isActive: true,
              category: `0000000000000000000000000000000000000000`,
              subCategory: `0000000000000000000000000000000000000000`,
              quantity: 2,
              pricePerUnit: uid,
              batchId: `batchId_${uid}`,
              inventoryType: `inventoryType_${uid}`,
              inventoryStatus: 2
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
  addEventArgs(itemsAddress, certifierAddress, uid) {
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
  },
  updateProductArgs(address, uid) {
      const args = {
          marketplaceItemAddress: address,
          updates: {
              description: `description_${uid}`,
              imageKey: `imageKey_${uid}`,
              isActive: false,
              userUniqueProductCode: `userUniqueProductCode_${uid}`
          }
      }

      return args
  },
  deleteProductArgs(address) {
      const args = {
          marketplaceItemAddress: address
      }

      return args;
  },
  updateInventoryArgs(address, uid) {
      const args = {
          marketplaceItemAddress: address,
          updates: {
              pricePerUnit: uid,
              status: 1
          }
      }

      return args;
  },
  updateInventoriesQuantitiesArgs(marketplaceItemAddress, _quantity) {
      const args = {
          inventories: [marketplaceItemAddress],
          quantities: [_quantity],
          isReduce: true
      }

      return args;
  },
};

export default factory;
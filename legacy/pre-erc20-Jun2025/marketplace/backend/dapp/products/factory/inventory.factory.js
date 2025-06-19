/** Factory creation for Inventory arguments. */
const factory = {
  /** Sample arguments for creating a Inventory contract. Use util.uid() to generate a uid. */
  getInventoryArgs(uid, userAddress) {
    const args = {
      category: 'Carbon',
      subCategory: 'Carbon Credit',
      quantity: 3,
      pricePerUnit: uid,
      batchId: `batchId_${uid}`,
      status: 2,
      createdDate: new Date().getTime(),
      owner: userAddress,
    };

    return args;
  },
  updateInventoryArgs(address, inventoryAddress, uid) {
    const args = {
      productAddress: address,
      inventory: inventoryAddress,
      updates: {
        pricePerUnit: uid,
        status: 1,
      },
    };

    return args;
  },
};

export default factory;

export const itemArgs = (productId, inventoryId, uid) => {
  const args = {
    itemArgs: {
      productId: productId,
      inventoryId: inventoryId,
      serialNumber: `serialNumber_${uid}`,
      status: 1,
      comment: `comment_${uid}`,
    },
  };

  return args;
};

export const updateItemArgs = (address, uid) => {
  const args = {
    itemAddress: address,
    updates: {
      status: 2,
      comment: `comment_${uid}`,
    },
  };

  return args;
};

export const transferItemArgs = (itemAddress, newOwner) => {
  const args = {
    itemsAddress: itemAddress, // array of item addresses
    newOwner: newOwner,
    newQuantity: 1,
  };

  return args;
};

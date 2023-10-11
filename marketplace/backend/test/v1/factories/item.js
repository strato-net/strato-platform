
export const itemArgs = (productId, inventoryId, uid) => {
  const args = {
    itemArgs: {
      productId: productId,
      inventoryId: inventoryId,
      serialNumber: `serialNumber_${uid}`,
      status: 1,
      comment: `comment_${uid}`
    }
  }

  return args
}

export const updateItemArgs = (address, uid) => {
  const args = {
    itemAddress: address,
    updates: {
      status: 2,
      comment: `comment_${uid}`
    }
  }

  return args
}

export const giftItemArgs = (itemAddress, newOwner, dappAddress) => {
  const args = {
    itemsAddress: [itemAddress],
    newOwner: newOwner,
    dappAddress: dappAddress,
    newQuantity: 1,
    itemNumber: 1,
    isGiftedTransfer: true
  }

  return args
}
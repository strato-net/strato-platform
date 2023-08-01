
export const itemArgs = (uid) => {
  const args = {
    itemArgs: {
      productId: '0000000000000000000000000000000000000100',
      inventoryId: '0000000000000000000000000000000000000100',
      creditBatchSerialization: `serialNumber_${uid}`,
      quantity: 10,
      status: 1,
    }
  }

  return args
}

export const updateItemArgs = (address, uid) => {
  const args = {
    itemAddress: address,
    updates: {
      status: 2,
    }
  }

  return args
}
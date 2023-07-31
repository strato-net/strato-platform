
export const itemArgs = (uid) => {
  const args = {
    itemArgs: {
      productId: '0000000000000000000000000000000000000100',
      inventoryId: '0000000000000000000000000000000000000100',
      creditBatchSerialization: `serialNumber_${uid}`,
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
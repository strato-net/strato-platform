
export const itemArgs = (uid) => {
  const args = {
    itemArgs: {
      productId: '0000000000000000000000000000000000000100',
      inventoryId: '0000000000000000000000000000000000000100',
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
export const productArgs = (uid) => {
  const args = {
    productArgs: {
      name: `name_${uid}`,
      description: `description_${uid}`,
      manufacturer: `manufacturer_${uid}`,
      unitOfMeasurement: 1,
      userUniqueProductCode: `userUniqueProductCode_${uid}`,
      leastSellableUnit: uid,
      imageKey: `1673855860544_seeds.jpg`,
      isActive: true,
      category: 'Carbon',
      subCategory: 'Carbon Credit'
    }
  }

  return args
}

export const updateProductArgs = (address, uid) => {
  const args = {
    productAddress: address,
    updates: {
      description: `description_${uid}`,
      imageKey: `1673855860544_seeds.jpg`,
      isActive: false,
      userUniqueProductCode: `userUniqueProductCode_${uid}`
    }
  }
  return args 
}

export const updateImageProductArgs = (address, uid) => {
  const args = {
    productAddress: address,
    updates: {
      description: `description_${uid}`,
      imageKey: `newImage_seeds.jpg`,
      isActive: false,
      userUniqueProductCode: `userUniqueProductCode_${uid}`,
      oldImageKey: `1673855860544_seeds.jpg`,
    }
  }
  return args
}
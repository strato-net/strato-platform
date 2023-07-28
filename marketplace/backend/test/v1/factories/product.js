export const productArgs = (uid) => {
  const args = {
    productArgs: {
      name: `name_${uid}`,
      description: `description_${uid}`,
      imageKey: `1673855860544_seeds.jpg`,
      isActive: true,
      category: 'Carbon',
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
      oldImageKey: `1673855860544_seeds.jpg`,
    }
  }
  return args
}
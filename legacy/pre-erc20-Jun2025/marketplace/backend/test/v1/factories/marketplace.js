export const categoryArgs = (uid) => {
  const args = {
    name: `name_${uid}`,
    description: `description_${uid}`,
    imageKey: '1675078111777_seeds.jpg',
  };

  return args;
};

export const subCategoryArgs = (categoryAddress, uid) => {
  const args = {
    categoryAddress,
    name: `name_${uid}`,
    description: `description_${uid}`,
  };

  return args;
};

export const productArgs = (uid, category, subCategory) => {
  const args = {
    productArgs: {
      name: `name_${uid}`,
      description: `description_${uid}`,
      manufacturer: `manufacturer_${uid}`,
      unitOfMeasurement: 1,
      userUniqueProductCode: `uniqueProductCode_${uid}`,
      leastSellableUnit: uid,
      imageKey: `1673855860544_seeds.jpg`,
      isActive: true,
      category: category,
      subCategory: subCategory,
    },
  };

  return args;
};

export const inventoryArgs = (address, uid) => {
  const quantity = 2;
  const args = {
    quantity,
    productAddress: address,
    pricePerUnit: uid,
    batchId: `batchId_${uid}`,
    status: 1,
    serialNumber: [
      {
        itemSerialNumber: `${uid}1`,
        rawMaterials: [
          {
            rawMaterialProductName: 'Cotton Fabric',
            rawMaterialProductId: 'CF1',
            rawMaterialSerialNumbers: ['X561', 'X7666', 'X7667'],
          },
        ],
      },
      {
        itemSerialNumber: `${uid}2`,
        rawMaterials: [],
      },
    ],
  };

  return args;
};

export const marketplaceArgs = (
  category,
  subCategory,
  productName,
  brandName
) => {
  const args = {
    category: [category],
    subCategory: [subCategory],
    name: [productName],
    manufacturer: [brandName],
  };

  return args;
};

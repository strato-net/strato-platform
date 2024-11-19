export const inventoryArgs = (address, uid) => {
  const quantity = 5;
  const args = {
    quantity,
    productAddress: address,
    pricePerUnit: 20,
    batchId: `batchId_${uid}`,
    status: 1,
    inventoryType: 'inventoryType',
    serialNumber: [
      {
        itemSerialNumber: `${uid}1`,
        rawMaterials: [
          {
            rawMaterialProductName: 'Cotton Fabric',
            rawMaterialProductId: 'CF1',
            rawMaterialSerialNumbers: ['X561', 'X7666', 'X7667'],
          },
          {
            rawMaterialProductName: 'Cotton Thread',
            rawMaterialProductId: 'CT1',
            rawMaterialSerialNumbers: ['U89889'],
          },
        ],
      },
      {
        itemSerialNumber: `${uid}2`,
        rawMaterials: [
          {
            rawMaterialProductName: 'Cotton Fabric',
            rawMaterialProductId: 'CF1',
            rawMaterialSerialNumbers: ['X561', 'X7666', 'X7667'],
          },
          {
            rawMaterialProductName: 'Cotton Thread',
            rawMaterialProductId: 'CT1',
            rawMaterialSerialNumbers: ['U89889'],
          },
        ],
      },
      {
        itemSerialNumber: `${uid}3`,
        rawMaterials: [
          {
            rawMaterialProductName: 'Cotton Fabric',
            rawMaterialProductId: 'CF1',
            rawMaterialSerialNumbers: ['X561', 'X7666', 'X7667'],
          },
          {
            rawMaterialProductName: 'Cotton Thread',
            rawMaterialProductId: 'CT1',
            rawMaterialSerialNumbers: ['U89889'],
          },
        ],
      },
      {
        itemSerialNumber: `${uid}4`,
        rawMaterials: [
          {
            rawMaterialProductName: 'Cotton Fabric',
            rawMaterialProductId: 'CF1',
            rawMaterialSerialNumbers: ['X561', 'X7666', 'X7667'],
          },
          {
            rawMaterialProductName: 'Cotton Thread',
            rawMaterialProductId: 'CT1',
            rawMaterialSerialNumbers: ['U89889'],
          },
        ],
      },
      {
        itemSerialNumber: `${uid}5`,
        rawMaterials: [
          {
            rawMaterialProductName: 'Cotton Fabric',
            rawMaterialProductId: 'CF1',
            rawMaterialSerialNumbers: ['X561', 'X7666', 'X7667'],
          },
          {
            rawMaterialProductName: 'Cotton Thread',
            rawMaterialProductId: 'CT1',
            rawMaterialSerialNumbers: ['U89889'],
          },
        ],
      },
    ],
  };
  return args;
};

export const inventoryArgsWithNoSN = (address, uid) => {
  const quantity = 5;
  const args = {
    quantity,
    productAddress: address,
    pricePerUnit: 20,
    batchId: `batchId_${uid}`,
    status: 1,
    serialNumber: [],
  };
  return args;
};

export const newInventoryArgs = (address, uid) => {
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

export const updateInventoryArgs = (address, inventoryAddress, uid) => {
  const args = {
    productAddress: address,
    inventory: inventoryAddress,
    updates: {
      pricePerUnit: uid,
      status: 1,
    },
  };

  return args;
};

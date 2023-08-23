export const categoryArgs = (uid) => {
    const args = {
        name: `name_${uid}`,
        description: `description_${uid}`,
        imageKey: '1675078111777_seeds.jpg'
    }

    return args
}

export const productArgs = (uid, category) => {
    const args = {
        productArgs: {
            name: `name_${uid}`,
            description: `description_${uid}`,
            imageKey: `1673855860544_seeds.jpg`,
            isActive: true,
            category: category,
        }
    }

    return args
}

export const inventoryArgs = (address, uid) => {
    const availableQuantity = 2
    const args = {
        availableQuantity,
        productAddress: address,
        pricePerUnit: uid,
        vintage: 2000,
        status: 1,
        serialNumber: [
            {
                "itemSerialNumber": `${uid}1`,
                "rawMaterials": [{
                    "rawMaterialProductName": "Cotton Fabric",
                    "rawMaterialProductId": "CF1",
                    "rawMaterialSerialNumbers": ["X561", "X7666", "X7667"]
                }]
            },
            {
                "itemSerialNumber": `${uid}2`,
                "rawMaterials": []
            }
        ]
    }

    return args
}

export const marketplaceArgs = (category, productName, brandName) => {
    const args = {
        category: [category],
        name: [productName],
    }

    return args
}
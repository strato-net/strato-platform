import { util } from "blockapps-rest";
/** Factory creation for RawMaterial arguments. */
const factory = {
    /** Sample arguments for creating a RawMaterial contract. Use util.uid() to generate a uid. */
    getRawMaterialArgs(uid) {
        const args = {
            appChainId: `${uid}`,
            itemSerialNumber: `itemSerialNumber_${uid}`,
            rawMaterialSerialNumber: `rawMaterialSerialNumber_${uid}`,
            rawMaterialProductName: `rawMaterialProductName_${uid}`,
            itemUniqueProductCode: parseInt(util.iuid()),
            rawMaterialProductId: `rawMaterialProductId_${uid}`,
            createdDate: new Date().getTime()
        }

        return args;
    }
};

export default factory;

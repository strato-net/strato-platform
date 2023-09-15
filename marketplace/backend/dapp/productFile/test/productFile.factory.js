/** Factory creation for ProductFile arguments. */
const factory = {
    /** Sample arguments for creating a ProductFile contract. Use util.uid() to generate a uid. */
    getProductFileArgs(uid) {
        const args = {
            productId: `${uid + 2}`.padStart(40, "0"),
            fileLocation: `fileLocation_${uid}`,
            fileHash: `fileHash_${uid}`,
            fileName: `fileName_${uid}`,
            uploadDate: uid,
            createdDate: uid,
            section: 1,
            type: 1,
          };
          return args;
    },
    updateProductFileArgs(uid) {
        const args = {
            fileLocation: `fileLocation_${uid}`,
            fileHash: `fileHash_${uid}`,
            fileName: `fileName_${uid}`,
            uploadDate: uid,
            section: 1,
            type: 2,
        };
        return args;
    },
};

export default factory;

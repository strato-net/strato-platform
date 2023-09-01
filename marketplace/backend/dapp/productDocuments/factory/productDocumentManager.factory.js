/** Factory creation for Properties arguments. */
const factory = {
  getProductDocumentManagerArgs(uid) {
    const args = {
      productId: `${uid + 2}`.padStart(40, '0'),
      fileKey: `fileKey_${uid}`,
      fileName: `fileName_${uid}`,
      documentType: `documentType_${uid}`,
      uploadDate: 0,
      delDate: 0
    }
    return args;
  },
};

export default factory;

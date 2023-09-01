/** Factory creation for Properties arguments. */
const factory = {
  createArgs(uid) {
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
  getArgs(uid) {
    const args = {

    }
    return args;
  },
  getAllArgs(uid) {
    const args = {

    }
    return args;
  },
  getDeleteArgs(uid) {
    const args = {
    productDocumentAddress: `${uid + 2}`.padStart(40, '0')
    }
    return args;
  }
};

export default factory;

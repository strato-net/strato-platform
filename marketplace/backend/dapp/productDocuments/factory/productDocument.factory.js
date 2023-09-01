/** Factory creation for Properties arguments. */
const factory = {
  getProductDocumentArgs(uid) {
    const args = {
      productId: `${uid + 2}`.padStart(40, '0'),
      fileKey: "",
      fileName: "",
      documentType: "",
      uploadDate: 0,
      delDate: 0
    }
    return args;
  },
};

export default factory;

export const productFileArgs = (uid) => {
  const args = {
    productId: `${uid + 2}`.padStart(40, "0"),
    fileLocation: `fileLocation_${uid}`,
    fileHash: `fileHash_${uid}`,
    fileName: `fileName_${uid}`,
    uploadDate: uid,
    section: 1,
    type: 1,
  };

  return args;
};

export const updateProductFileArgs = (address, uid) => {
  const args = {
    address,
    updates: {
      fileLocation: `fileLocation_${uid}`,
      fileHash: `fileHash_${uid}`,
      fileName: `fileName_${uid}`,
      uploadDate: uid,
      section: 1,
      type: 2,
    }
  };

  return args;
};

/** Factory creation for Review arguments. */
const factory = {
  getReviewArgs(uid) {
    const args = {
      productId: `${uid + 2}`.padStart(40, "0"),
      propertyId: `${uid + 2}`.padStart(40, "0"),
      reviewerAddress: `${uid + 2}`.padStart(40, "0"),
      reviewerName: `reviewerName_${uid}`,
      title: `title_${uid}`,
      description: `description_${uid}`,
      rating: 5,
      createdDate: 0,
      delDate: 0,
    };
    return args;
  },
  updateReviewArgs(uid) {
    const args = {
      address: `${uid + 2}`.padStart(40, "0"),
      title: `title_${uid}`,
      description: `description_${uid}`,
      rating: 5,
    };
    return args;
  },
  deleteReviewArgs(uid) {
    const args = {
      reviewAddress: `${uid + 2}`.padStart(40, "0"),
    };
    return args;
  },
  getAllReviewArgs(uid) {
    const args = {
      productId: `${uid + 2}`.padStart(40, "0"),
      propertyId: `${uid + 2}`.padStart(40, "0"),
    };
    return args;
  },
};

export default factory;

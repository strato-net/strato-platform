export const membershipServiceArgs = (uid) => {
  const args = {
    membershipId: `${uid + 2}`.padStart(40, "0"),
    serviceId: `${uid + 2}`.padStart(40, "0"),
    membershipPrice: uid,
    discountPrice: uid,
    maxQuantity: uid,
    createdDate: uid,
    isActive: true,
  };

  return args;
};

export const updateMembershipServiceArgs = (address, uid) => {
  const args = {
    address,
    updates: {
      membershipId: `${uid + 2}`.padStart(40, "0"),
      serviceId: `${uid + 2}`.padStart(40, "0"),
      membershipPrice: uid,
      discountPrice: uid,
      maxQuantity: uid,
      createdDate: uid,
      isActive: true,
    },
  };

  return args;
};

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

export const membershipServiceArgsSingle = (uid) => {
  const args = {
    membershipId: `0110000101110010011010010111100101100001`,
    serviceId: `f7bc339caea0e8815434812ffb09c842dd0234db`,
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

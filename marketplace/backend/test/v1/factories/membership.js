export const membershipArgs = (uid) => {
  const args = {
    productId: `${uid + 2}`.padStart(40, "0"), // chainID
    timePeriodInMonths: uid,
    additionalInfo: `additionalInfo_${uid}`,
    createdDate: uid,
  };

  return args;
};

export const updateMembershipArgs = (address, uid) => {
  const args = {
    address,
    updates: {
      productId: `${uid + 2}`.padStart(40, "0"), // chainID
      timePeriodInMonths: uid,
      additionalInfo: `additionalInfo_${uid}`,
      createdDate: uid,
    },
  };

  return args;
};

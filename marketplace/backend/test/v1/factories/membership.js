export const membershipArgs = (uid) => {
  const args = {
    productId: `${uid + 2}`.padStart(40, "0"), // chainID
    timePeriodInMonths: uid,
    additionalInfo: `additionalInfo_${uid}`,
    createdDate: uid,
  };

  return args;
};

export const membershipArgsSingle = (uid) => {
  const args = {
    productId: `0110000101110010011010010111100101100001`,
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

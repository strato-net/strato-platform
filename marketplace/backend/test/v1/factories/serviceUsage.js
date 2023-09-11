export const serviceUsageArgs = (uid) => {
  const args = {
    itemId: `${uid + 2}`.padStart(40, '0'),  // chainID
    serviceId: `${uid + 2}`.padStart(40, '0'),  // chainID
    serviceDate: uid,
    summary: `summary_${uid}`,
    status: 1,
    paymentStatus: 1,
    providerLastUpdated: `${uid + 2}`.padStart(40, '0'),
    providerComment: `providerComment_${uid}`,
    providerLastUpdatedDate: uid,
    pricePaid: uid,
  };

  return args;
};

export const updateServiceUsageArgs = (address, uid) => {
  const args = {
    address,
    updates: {
      serviceDate: uid,
      summary: `summary_${uid}`,
      status: 2,
      paymentStatus: 2,
      providerLastUpdated: `${uid + 2}`.padStart(40, '0'),
      providerComment: `providerComment_${uid}`,
      providerLastUpdatedDate: uid,
      pricePaid: uid,
    }
  };

  return args;
};


export const membershipArgs = (uid) => {
  const args = {
    membershipArgs: {
        productId: `${uid + 2}`.padStart(40, '0'),  // chainID
        timePeriodInMonths: uid,
        additionalInfo: `additionalInfo_${uid}`,
        createdDate: uid,
    },
    isPublic: true
  }

  return args
}

export const updateMembershipArgs = (address, chainId, uid) => {
  const args = {
    address,
    chainId,
    updates: {
        productId: `${uid + 2}`.padStart(40, '0'),  // chainID
        timePeriodInMonths: uid,
        additionalInfo: `additionalInfo_${uid}`,
        createdDate: uid,
    }
  }

  return args
}
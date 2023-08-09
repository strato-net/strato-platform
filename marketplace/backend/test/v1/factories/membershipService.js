
export const membershipServiceArgs = (uid) => {
  const args = {
    membershipServiceArgs: {
        membershipId: `${uid + 2}`.padStart(40, '0'),  // chainID
        serviceId: `${uid + 2}`.padStart(40, '0'),  // chainID
        membershipPrice: uid,
        discountPrice: uid,
        maxQuantity: uid,
        createdDate: uid,
        isActive: true,
    },
    isPublic: false
  }

  return args
}

export const updateMembershipServiceArgs = (address, chainId, uid) => {
  const args = {
    address,
    chainId,
    updates: {
        membershipId: `${uid + 2}`.padStart(40, '0'),  // chainID
        serviceId: `${uid + 2}`.padStart(40, '0'),  // chainID
        membershipPrice: uid,
        discountPrice: uid,
        maxQuantity: uid,
        createdDate: uid,
        isActive: true,
    }
  }

  return args
}

export const userMembershipArgs = (uid,userAddress) => {
    const args = {
          username:`username_${uid}`,
          userAddress,
          role:1
    }
  
    return args
  }
  
  export const updateUserMembershipArgs = (address, uid) => {
    const args = {
      address,
      updates: {
          role:2
      }
    }
  
    return args
  }
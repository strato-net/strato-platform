const factory = {
  getOrganizationMembershipArgs(uid) {
    const args = {
      organizationCommonName: `org_${uid}`,
      requesterAddress: `${uid}`.padStart(40, '0'),
      requesterUsername: `user_${uid}`,
    }
    return args
  },
  getOrganizationMembershipManagerArgs(uid) {
    const args = {
      organizationCommonName: `org_${uid}`,
      requesterUsername: `user_${uid}`, 
    }
    return args
  },
}

export default factory

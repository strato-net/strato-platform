const factory = {
  getApplicationArgs(uid) {
    const args = {
      name: `org_${uid}`,
      ownerOrganization: `${uid}`.padStart(40, '0'),
    }
    return args
  },
}

export default factory

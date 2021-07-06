const factory = {
  getOrganizationArgs(uid) {
    const args = {
      commonName: `org_${uid}`,
      legalName: `legalName_${uid}`,
      addressLine1: `addressLine_${uid}_1`,
      addressLine2: `addressLin_${uid}_2`,
      addressLine3: `addressLin_${uid}_3`,
      state: `state_${uid}`,
      country: `country_${uid}`,
      postalCode: `${uid}`,
    }
    return args
  },
}

export default factory

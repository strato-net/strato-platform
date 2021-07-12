const factory = {
  getNetworkOnboardingUserArgs(uid) {
    const args = {
      username: `user_${uid}`,
      blockchainAddress: `${uid + 1}`.padStart(40, '0'),
      organization: `${uid + 2}`.padStart(40, '0'),
    }
    return args
  },
}

export default factory

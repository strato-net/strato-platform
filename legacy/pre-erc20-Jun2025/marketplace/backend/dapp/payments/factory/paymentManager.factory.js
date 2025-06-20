const factory = {
  getPaymentArgs: (uid) => {
    const args = {
      paymentSessionId: `paymentSessionId_${uid}`,
      paymentService: `paymentService_${uid}`,
      paymentStatus: `paymentStatus_${uid}`,
      sessionStatus: `sessionStatus_${uid}`,
      amount: `${uid}`,
      sellerAccountId: `sellerAccountId_${uid}`,
      expiresAt: new Date().getTime(),
      createdDate: new Date().getTime(),
    };
    return args;
  },
  getUpdatePaymentArgs: (uid, address) => {
    const args = {
      payment: address,
      paymentStatus: `paymentStatus_${uid}`,
      sessionStatus: `sessionStatus_${uid}`,
      paymentIntentId: `paymentIntentId_${uid}`,
    };
    return args;
  },
};

export default factory;

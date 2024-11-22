const factory = {
  getPaymentArgs: (uid) => {
    const args = {
      paymentSessionId: `paymentSessionId_${uid}`,
      paymentService: `paymentService_${uid}`,
      paymentStatus: `paymentStatus_${uid}`,
      sessionStatus: `sessionStatus_${uid}`,
      sellerAccountId: `sellerAcountId_${uid}`,
      amount: `${uid}`,
      sellerAccountId: `sellerAccountId_${uid}`,
      expiresAt: new Date().getTime(),
      createdDate: new Date().getTime(),
    };
    return args;
  },
};

export default factory;

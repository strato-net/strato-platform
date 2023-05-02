const factory = {
    getPaymentArgs: (uid) => {
        const args = {
            appChainId: `${uid}`,
            paymentSessionId: `paymentSessionId_${uid}`,
            paymentProvider: `paymentProvider_${uid}`,
            paymentStatus: `paymentStatus_${uid}`,
            sessionStatus: `sessionStatus_${uid}`,
            amount: `${uid}`,
            expiresAt: new Date().getTime(),
            createdDate: new Date().getTime(),
        }
        return args;
    }
}

export default factory;

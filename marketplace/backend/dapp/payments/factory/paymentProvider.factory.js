const factory = {
    getPaymentProviderArgs: (uid) => {
        const args = {
            appChainId: `${uid}`,
            name: 1,
            accountId: `accountId_${uid}`,
            createdDate: new Date().getTime(),
        }
        return args;
    },
}

export default factory;
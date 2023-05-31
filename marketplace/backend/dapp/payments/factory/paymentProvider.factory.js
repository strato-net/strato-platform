const factory = {
    getPaymentProviderArgs: (uid) => {
        const args = {
            name: 1,
            accountId: `accountId_${uid}`,
            createdDate: new Date().getTime(),
        }
        return args;
    },
}

export default factory;
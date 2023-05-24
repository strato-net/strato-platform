const factory = {
    /** Sample arguments for creating an Event contract. Use util.uid() to generate a uid. */
    getEventTypeArgs(uid) {
        const args = {
            name: `originalname_${uid}`,
            description: `description_${uid}`,
            createdDate: 1673022591,
        };
        return args;
    },
};

export default factory;
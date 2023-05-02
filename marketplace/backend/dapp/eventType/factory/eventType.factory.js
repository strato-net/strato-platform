/** Factory creation for EventType arguments. */
const factory = {
    /** Sample arguments for creating a EventType contract. Use util.uid() to generate a uid. */
    getEventTypeArgs(uid) {
        const args = {
            appChainId: `${uid}`,
            name: `name_${uid}`,
            description: `description_${uid}`,
            createdDate: uid,
        };
        return args;
    },
};

export default factory;

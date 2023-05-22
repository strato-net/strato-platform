import constants from "/helpers/constants";
/** Factory creation for Event arguments. */
const factory = {
    /** Sample arguments for creating a Event contract. Use util.uid() to generate a uid. */
    getEventArgs(uid) {
        const args = {
            itemAddress: '0000000000000000000000000000000000000000',
            eventTypeId: '0000000000000000000000000000000000000000',
            eventBatchId: uid,
            itemSerialNumber: `${uid}`,
            date: uid,
            summary: `summary_${uid}`,
            certifier: constants.testOrg3,
            createdDate: new Date().getTime(),
        }

        return args;
    }
};

export default factory;

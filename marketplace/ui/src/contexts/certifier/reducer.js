import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
  switch (action.type) {
    case actionDescriptors.fetchCertifiers:
      return {
        ...state,
        isCertifiersLoading: true
      };
    case actionDescriptors.fetchCertifiersSuccessful:
      return {
        ...state,
        certifiers: action.payload,
        isCertifiersLoading: false
      };
    case actionDescriptors.fetchCertifiersFailed:
      return {
        ...state,
        error: action.error,
        isCertifiersLoading: false
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;

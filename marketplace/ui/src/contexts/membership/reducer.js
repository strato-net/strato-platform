import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
  switch (action.type) {
    case actionDescriptors.fetchMembershipOfInventory:
      return {
        ...state,
        isMembershipLoading: true
      };
    case actionDescriptors.fetchMembershipOfInventorySuccessful:
      return {
        ...state,
        membershipServices: action.payload.membershipServices,
        membership: action.payload.membership,
        isMembershipLoading: false
      };
    case actionDescriptors.fetchMembershipOfInventoryFailed:
      return {
        ...state,
        error: action.error,
        isMembershipLoading: false
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;

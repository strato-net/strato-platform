import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
  let isLoading;
  switch (action.type) {
    case actionDescriptors.resetMessage:
      return {
        ...state,
        success: false,
        message: null,
      };
    case actionDescriptors.setMessage:
      return {
        ...state,
        success: action.success,
        message: action.message,
      };
    case actionDescriptors.requestUserMembership:
      return {
        ...state,
        isRequestingMembership: true,
      };
    case actionDescriptors.requestUserMembershipSuccessful:
      return {
        ...state,
        requestedMembership: action.payload,
        isRequestingMembership: false,
      };
    case actionDescriptors.requestUserMembershipFailed:
      return {
        ...state,
        error: action.error,
        isRequestingMembership: false,
      };
    case actionDescriptors.updateUserMembership:
      return {
        ...state,
        isUpdatingMembership: true,
      };
    case actionDescriptors.updateUserMembershipSuccessful:
      return {
        ...state,
        updatedMembership: action.payload,
        isUpdatingMembership: false,
      };
    case actionDescriptors.updateUserMembershipFailed:
      return {
        ...state,
        error: action.error,
        isUpdatingMembership: false,
      };
    case actionDescriptors.addUserMembership:
      return {
        ...state,
        isAddingMembership: true,
      };
    case actionDescriptors.addUserMembershipSuccessful:
      return {
        ...state,
        addedMembership: action.payload,
        isAddingMembership: false,
      };
    case actionDescriptors.addUserMembershipFailed:
      return {
        ...state,
        error: action.error,
        isAddingMembership: false,
      };
    case actionDescriptors.fetchPendingRequestsList:
      return {
        ...state,
        isRequestsListLoading: true,
      };
    case actionDescriptors.fetchRequestsListSuccessful:
      return {
        ...state,
        requestsList: action.payload,
        isRequestsListLoading: false,
      };
    case actionDescriptors.fetchRequestsListFailed:
      return {
        ...state,
        error: action.error,
        isRequestsListLoading: false,
      };

      case actionDescriptors.fetchApprovedUsersList:
        return {
          ...state,
          isApprovedUsersListLoading: true,
        };
      case actionDescriptors.fetchApprovedUsersListSuccessful:
        return {
          ...state,
          approvedUsersList: action.payload,
          isApprovedUsersListLoading: false,
        };
      case actionDescriptors.fetchApprovedUsersListFailed:
        return {
          ...state,
          error: action.error,
          isApprovedUsersListLoading: false,
        };
        case actionDescriptors.approveRejectMembershipRequest:
          isLoading = new Array(state.requestsList.length).fill({accept: false, reject: false});
          isLoading[action.index] = action.value === 1 ? {accept: true, reject: false} : {accept: false, reject: true};
          console.log(isLoading[action.index])
          return {
            ...state,
            isAcceptMembershipLoading: isLoading,
            isRequestsListLoading:true,
          };
        case actionDescriptors.approveRejectMembershipRequestSuccessful:
          isLoading = new Array(state.requestsList.length).fill({accept: false, reject: false});
          return {
            ...state,
            acceptOrRejectMembership: action.payload,
            isAcceptMembershipLoading: isLoading,
            isRequestsListLoading:false,
          };
        case actionDescriptors.approveRejectMembershipRequestFailed:
          isLoading = new Array(state.requestsList.length).fill({accept: false, reject: false});
          return {
            ...state,
            error: action.error,
            isAcceptMembershipLoading: isLoading,
            isRequestsListLoading:false,
          };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;

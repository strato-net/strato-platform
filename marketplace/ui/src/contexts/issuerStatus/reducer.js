import { actionDescriptors } from './actions';

const reducer = (state, action) => {
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
    case actionDescriptors.requestReview:
      return {
        ...state,
        requestingReview: true,
      };
    case actionDescriptors.requestReviewSuccessful:
      return {
        ...state,
        requestingReview: false,
      };
    case actionDescriptors.requestReviewFailed:
      return {
        ...state,
        requestingReview: false,
      };
    case actionDescriptors.authorizeIssuer:
      return {
        ...state,
        changingIssuerStatus: true,
      };
    case actionDescriptors.authorizeIssuerSuccessful:
      return {
        ...state,
        changingIssuerStatus: false,
      };
    case actionDescriptors.authorizeIssuerFailed:
      return {
        ...state,
        changingIssuerStatus: false,
      };
    case actionDescriptors.deauthorizeIssuer:
      return {
        ...state,
        changingIssuerStatus: true,
      };
    case actionDescriptors.deauthorizeIssuerSuccessful:
      return {
        ...state,
        changingIssuerStatus: false,
      };
    case actionDescriptors.deauthorizeIssuerFailed:
      return {
        ...state,
        changingIssuerStatus: false,
      };
    case actionDescriptors.modifyAdmin:
      return {
        ...state,
        changingAdminStatus: true,
      };
    case actionDescriptors.modifyAdminSuccessful:
      return {
        ...state,
        changingAdminStatus: false,
      };
    case actionDescriptors.modifyAdminFailed:
      return {
        ...state,
        changingAdminStatus: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;

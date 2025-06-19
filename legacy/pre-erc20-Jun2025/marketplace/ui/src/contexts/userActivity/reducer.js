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
    case actionDescriptors.fetchUserActivity:
      return {
        ...state,
        isUserActivityLoading: true,
      };
    case actionDescriptors.fetchUserActivitySuccessful:
      return {
        ...state,
        userActivity: action.payload,
        isUserActivityLoading: false,
      };
    case actionDescriptors.fetchUserActivityFailed:
      return {
        ...state,
        error: action.error,
        isUserActivityLoading: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;

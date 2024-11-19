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
    case actionDescriptors.fetchUserTransaction:
      return {
        ...state,
        isTransactionLoading: true,
      };
    case actionDescriptors.fetchUserTransactionSuccessful:
      return {
        ...state,
        userTransactions: action.payload?.data,
        count: action.payload?.count,
        isTransactionLoading: false,
      };
    case actionDescriptors.fetchUserTransactionFailed:
      return {
        ...state,
        error: action.error,
        isTransactionLoading: false,
      };
    case actionDescriptors.fetchGlobalTransaction:
      return {
        ...state,
        isTransactionLoading: true,
      };
    case actionDescriptors.fetchGlobalTransactionSuccessful:
      return {
        ...state,
        globalTransactions: action.payload?.data,
        count: action.payload?.count,
        isTransactionLoading: false,
      };
    case actionDescriptors.fetchGlobalTransactionFailed:
      return {
        ...state,
        error: action.error,
        isTransactionLoading: false,
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;

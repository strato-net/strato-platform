import {
  OPEN_VERIFY_ACCOUNT_MODAL,
  CLOSE_VERIFY_ACCOUNT_MODAL,
  VERIFY_TEMPORARY_PASSWORD_SUCCESS,
  VERIFY_TEMPORARY_PASSWORD_FAILURE,
  RESET_ERROR
} from '../VerifyAccount/verifyAccount.actions';

const initialState = {
  isOpen: false,
  isOTPVerified: false,
  error: null
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_VERIFY_ACCOUNT_MODAL:
      return {
        ...state,
        isOpen: true
      }
    case CLOSE_VERIFY_ACCOUNT_MODAL:
      return {
        ...state,
        isOpen: false
      }
    case VERIFY_TEMPORARY_PASSWORD_SUCCESS:
      return {
        ...state,
        isTempPasswordVerified: action.isTempPasswordVerified,
        error: null
      }
    case VERIFY_TEMPORARY_PASSWORD_FAILURE:
      return {
        ...state,
        isTempPasswordVerified: false,
        error: action.error
      }
    case RESET_ERROR:
      return {
        ...state,
        error: null
      }
    default:
      return state;
  }
};

export default reducer;
import {
  OPEN_VERIFY_ACCOUNT_MODAL,
  CLOSE_VERIFY_ACCOUNT_MODAL,
  VERIFY_OTP_FAILURE,
  VERIFY_OTP_SUCCESS
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
    case VERIFY_OTP_SUCCESS:
      return {
        ...state,
        isOTPVerified: action.isOTPVerified,
        error: null
      }
    case VERIFY_OTP_FAILURE:
      return {
        ...state,
        isOTPVerified: action.isOTPVerified,
        error: action.error
      }
    default:
      return state;
  }
};

export default reducer;
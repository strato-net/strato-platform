import {
  VERIFY_TEMPORARY_PASSWORD_SUCCESS,
  VERIFY_TEMPORARY_PASSWORD_FAILURE,
  RESET_ERROR,
  RESET_TEMPORARY_PASSWORD
} from '../VerifyAccount/verifyAccount.actions';

const initialState = {
  isTempPasswordVerified: false,
  error: null
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
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
    case RESET_TEMPORARY_PASSWORD:
      return {
        ...state,
        isTempPasswordVerified: false
      }
    default:
      return state;
  }
};

export default reducer;
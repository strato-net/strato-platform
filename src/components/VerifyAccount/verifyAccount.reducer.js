import {
  VERIFY_TEMPORARY_PASSWORD_SUCCESS,
  VERIFY_TEMPORARY_PASSWORD_FAILURE,
  RESET_ERROR
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
    default:
      return state;
  }
};

export default reducer;
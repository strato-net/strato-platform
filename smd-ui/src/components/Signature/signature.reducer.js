import {
  SIGN_REQUEST_SUCCESS,
  SIGN_REQUEST_FAILURE,  
  RESET_ERROR
} from './signature.action';

const initialState = {
  signedPayload: null,
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case SIGN_REQUEST_SUCCESS:
      return {
        ...state,
        signedPayload: action.signedPayload,
        error: null
      };
    case SIGN_REQUEST_FAILURE:
      return {
        ...state,
        signedPayload: null,
        error: action.signedPayloadError,
      };
    case RESET_ERROR:
      return {
        ...state,
        signedPayload: null,
        error: null
      };
    default:
      return state;
  }
};

export default reducer;

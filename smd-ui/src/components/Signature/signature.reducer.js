import {
  SIGN_REQUEST_SUCCESS,
  SIGN_REQUEST_FAILURE,  
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
        signedPayload: action.signedPayload
      };
    case SIGN_REQUEST_FAILURE:
      return {
        ...state,
        signedPayload: null,
        error: action.signedPayloadError,
      };
    default:
      return state;
  }
};

export default reducer;

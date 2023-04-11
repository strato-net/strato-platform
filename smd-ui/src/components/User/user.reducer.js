import {
  GET_OR_CREATE_OAUTH_USER_SUCCESS,
  GET_OR_CREATE_OAUTH_USER_FAILURE,
  FETCH_USER_PUBLIC_KEY_SUCCESS,
  FETCH_USER_PUBLIC_KEY_FAILURE,
  FETCH_USER_CERT_REQUEST,
  FETCH_USER_CERT_SUCCESS,
  FETCH_USER_CERT_FAILURE,
} from './user.actions';

const initialState = {
  oauthUser: undefined,
  publicKey : "abcde",
  certificateLoading: false,
  userCertificate: undefined,
  certificateError: undefined,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case GET_OR_CREATE_OAUTH_USER_SUCCESS:
      return {
        ...state,
        oauthUser: action.data
      }
    case GET_OR_CREATE_OAUTH_USER_FAILURE:
      return {
        ...state,
        oauthUser: null
      }
    case FETCH_USER_PUBLIC_KEY_SUCCESS:
      return {
        ...state,
        publicKey : action.publicKey,
      }
    case FETCH_USER_PUBLIC_KEY_FAILURE:
      return {
        ...state,
        error : action.error
      }
    case FETCH_USER_CERT_REQUEST:
      return {
        ...state,
        certificateLoading: true
      }
    case FETCH_USER_CERT_SUCCESS:
      return {
        ...state,
        certificateLoading: false,
        certificateError: undefined,
        userCertificate: action.cert,
      }
    case FETCH_USER_CERT_FAILURE:
      return {
        ...state,
        certificateLoading: false,
        certificateError: action.error,
      }
    default:
      return state;
  }
};

export default reducer;

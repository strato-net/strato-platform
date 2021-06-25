import {
  GET_OR_CREATE_OAUTH_USER_SUCCESS,
  GET_OR_CREATE_OAUTH_USER_FAILURE,
  FETCH_USER_PUBLIC_KEY_SUCCESS,
  FETCH_USER_PUBLIC_KEY_FAILURE
} from './user.actions';
import { getUserFromLocal } from '../../lib/localStorage';

const initialState = {
  oauthUser: getUserFromLocal(),
  publicKey : "abcde"
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
    default:
      return state;
  }
};

export default reducer;

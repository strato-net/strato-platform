import {
  GET_OR_CREATE_OAUTH_USER_SUCCESS,
  GET_OR_CREATE_OAUTH_USER_FAILURE,
  FETCH_USER_PUBLIC_KEY_SUCCESS,
  FETCH_USER_PUBLIC_KEY_FAILURE,
  fetchUserPubkey
} from './user.actions';
import { fetchUserPubKeyRequest} from './user.saga'
import { getUserFromLocal } from '../../lib/localStorage';

const initialState = {
  oauthUser: getUserFromLocal(),
  publicKey : "abcde",
  testing:  fetchUserPubKeyRequest().then()
};

const reducer = function (state = initialState, action) {
  console.log("in smd-ui/src/components/User/user.reducer.js ", action)
  switch (action.type) {
    case GET_OR_CREATE_OAUTH_USER_SUCCESS:
      return {
        ...state,
        oauthUser: action.data,
        isLoggedIn : true
      }
    case GET_OR_CREATE_OAUTH_USER_FAILURE:
      return {
        ...state,
        oauthUser: null,
        isLoggedIn : false

      }
    case FETCH_USER_PUBLIC_KEY_SUCCESS:
      return {
        ...state,
        publicKey : action.publicKey,
        isLoggedIn : true
      }
    case FETCH_USER_PUBLIC_KEY_FAILURE:
      return {
        ...state,
        error : action.error
      }
    default:
      return {...state, GarrettMadeThis: "tomorrow"};
  }
};

export default reducer;

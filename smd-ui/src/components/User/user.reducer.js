import {
  GET_OR_CREATE_OAUTH_USER_SUCCESS,
  GET_OR_CREATE_OAUTH_USER_FAILURE,
} from './user.actions';
import { getUserFromLocal } from '../../lib/localStorage';

const initialState = {
  oauthUser: getUserFromLocal()
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
    default:
      return state;
  }
};

export default reducer;

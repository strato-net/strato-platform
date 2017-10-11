import {
  HANDLE_ACCOUNT_SUCCESS,
  HANDLE_ACCOUNT_FAILURE,
  LOGOUT_ACCOUNT_SUCCESS
} from './account.actions';

const initialState = {
  email: null,
  currentUser: {},
  isLoggedIn: false,
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case HANDLE_ACCOUNT_SUCCESS: 
      return {
        currentUser: action.currentUser,
        email: action.email,
        isLoggedIn: true,
        error: null,
      };
    case HANDLE_ACCOUNT_FAILURE:
      return {
        currentUser: {},
        email: action.email,
        isLoggedIn: false,
        error: action.error,
      };
    case LOGOUT_ACCOUNT_SUCCESS: 
      return {
        currentUser: {},
        email: null,
        isLoggedIn: false
      }
    default:
      return state;
  }
};

export default reducer;

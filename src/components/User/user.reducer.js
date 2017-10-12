import {
  HANDLE_USER_SUCCESS,
  HANDLE_USER_FAILURE,
  LOGOUT_USER_SUCCESS,
  SET_CURRENT_USER
} from './user.actions';

const initialState = {
  email: null,
  currentUser: {},
  isLoggedIn: false,
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case HANDLE_USER_SUCCESS: 
      return {
        currentUser: action.currentUser,
        email: action.email,
        isLoggedIn: true,
        error: null,
      };
    case HANDLE_USER_FAILURE:
      return {
        currentUser: {},
        email: action.email,
        isLoggedIn: false,
        error: action.error,
      };
    case LOGOUT_USER_SUCCESS:
      return {
        currentUser: {},
        email: null,
        isLoggedIn: false
      }
    case SET_CURRENT_USER: 
      return {
        currentUser: action.currentUser,
        isLoggedIn: true
      }
    default:
      return state;
  }
};

export default reducer;

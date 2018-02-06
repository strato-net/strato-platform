import {
  LOGIN_REQUEST_SUCCESS,
  LOGIN_REQUEST_FAILURE,
  LOGOUT_REQUEST_SUCCESS,
  SET_CURRENT_USER,
  OPEN_LOGIN_OVERLAY,
  CLOSE_LOGIN_OVERLAY
} from './user.actions';

const initialState = {
  email: null,
  currentUser: {},
  isLoggedIn: false,
  error: null,
  isOpen: false
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_LOGIN_OVERLAY:
      return {
        isOpen: action.isOpen
      };
    case CLOSE_LOGIN_OVERLAY:
      return {
        isOpen: action.isOpen
      };
    case LOGIN_REQUEST_SUCCESS:
      return {
        currentUser: action.currentUser,
        email: action.email,
        isLoggedIn: true,
        error: null,
        isOpen: false
      };
    case LOGIN_REQUEST_FAILURE:
      return {
        currentUser: {},
        email: action.email,
        isLoggedIn: false,
        error: action.error,
        isOpen: true
      };
    case LOGOUT_REQUEST_SUCCESS:
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

import {
  LOGIN_REQUEST_SUCCESS,
  LOGIN_REQUEST_FAILURE,
  LOGOUT_REQUEST_SUCCESS,
  LOGIN_REQUEST,
  SET_CURRENT_USER,
  OPEN_LOGIN_OVERLAY,
  CLOSE_LOGIN_OVERLAY,
  RESET_ERROR
} from './user.actions';
import { currentUser } from '../../lib/parsejwt';

const initialState = {
  username: null,
  currentUser: currentUser(),
  isLoggedIn: JSON.stringify(currentUser()) !== JSON.stringify({}) ? true : false,
  error: null,
  isOpen: false,
  spinning: false
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_LOGIN_OVERLAY:
      return {
        ...state,
        isOpen: action.isOpen
      };
    case CLOSE_LOGIN_OVERLAY:
      return {
        ...state,
        isOpen: action.isOpen
      };
    case LOGIN_REQUEST:
      return {
        ...state,
        spinning: true
      }
    case LOGIN_REQUEST_SUCCESS:
      return {
        ...state,
        currentUser: action.currentUser,
        username: action.username,
        isLoggedIn: true,
        error: null,
        isOpen: false,
        spinning: false
      };
    case LOGIN_REQUEST_FAILURE:
      return {
        ...state,
        currentUser: {},
        username: action.username,
        isLoggedIn: false,
        error: action.error,
        isOpen: true,
        spinning: false
      };
    case LOGOUT_REQUEST_SUCCESS:
      return {
        ...state,
        currentUser: {},
        username: null,
        isLoggedIn: false
      }
    case SET_CURRENT_USER:
      return {
        ...state,
        currentUser: action.currentUser,
        isLoggedIn: true
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

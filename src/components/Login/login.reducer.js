import {
  VALIDATE_USER_SUCCESS,
  VALIDATE_USER_FAILURE,
  RESET_LOGIN_MESSAGE
} from './login.action';

const initialState = {
  result: undefined,
  redirectToReferrer: false
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case VALIDATE_USER_SUCCESS:
      localStorage.setItem('user', JSON.stringify({ "username": action.username, "address": action.address }));
      return {
        ...state,
        userName: action.username,
        address: action.address,
        result: 'login success',
        redirectToReferrer: true
      };
    case VALIDATE_USER_FAILURE:
      return {
        ...state,
        result: action.error,
        redirectToReferrer: false
      };
    case RESET_LOGIN_MESSAGE:
      return {
        ...state,
        result: undefined
      };
    default:
      return state;
  }
};

export default reducer;

import {
  CREATE_USER_FAILURE,
  CREATE_USER_SUCCESS,
  RESET_USER_ERROR,
  RESET_REDIRECT_REFER_REGISTER
} from './register.actions';

const initialState = {
  username: undefined,
  address: undefined,
  error: undefined,
  redirectToReferrer: false
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case CREATE_USER_SUCCESS:
      localStorage.setItem('user', JSON.stringify({ "username": action.username, "address": action.address }));
      return {
        username: action.username,
        address: action.address,
        error: undefined,
        redirectToReferrer: true
      };
    case CREATE_USER_FAILURE:
      return {
        username: undefined,
        address: undefined,
        error: action.error,
        redirectToReferrer: false
      };
    case RESET_USER_ERROR:
      return {
        error: undefined
      };
    case RESET_REDIRECT_REFER_REGISTER:
      return {
        ...state,
        redirectToReferrer: false
      }
    default:
      return state;
  }
};

export default reducer;
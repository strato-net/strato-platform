import {
  VALIDATE_USER_REQUEST,
  VALIDATE_USER_SUCCESS,
  VALIDATE_USER_FAILURE
} from './login.action';

const initialState = {
  result: 'Waiting to send...',
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
    default:
      return state;
  }
};

export default reducer;

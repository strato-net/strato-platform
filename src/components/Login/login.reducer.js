import {
  VALIDATE_USER_REQUEST,
  VALIDATE_USER_SUCCESS,
  VALIDATE_USER_FAILURE
} from './login.action';

const initialState = {
  result: 'Waiting to send...'
};


const reducer = function (state = initialState, action) {
  switch (action.type) {
    case VALIDATE_USER_REQUEST:
      return {
        ...state,
        userName: action.userName,
        result: 'Validating...',
      };
    case VALIDATE_USER_SUCCESS:
      return {
        ...state,
        result: 'login success'
      };
    case VALIDATE_USER_FAILURE:
      return {
        ...state,
        result: action.error
      };
    default:
      return state;
  }
};

export default reducer;

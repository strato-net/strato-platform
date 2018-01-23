import {
  CREATE_USER_REQUEST,
  CREATE_USER_FAILURE,
  CREATE_USER_SUCCESS,
} from './register.actions';

const initialState = {
  username: null,
  address: null,
  error: null
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case CREATE_USER_REQUEST:
      return {
        username: action.username,
        address: null,
        error: null
      };
    case CREATE_USER_SUCCESS:
      localStorage.setItem('user_name', action.username);
      localStorage.setItem('address', action.address);
      return {
        username: action.username,
        address: action.address,
        error: null
      };
    case CREATE_USER_FAILURE:
      localStorage.clear();
      return {
        username: null,
        address: null,
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;
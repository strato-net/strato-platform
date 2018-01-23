import {
  CREATE_USER_REQUEST,
  CREATE_USER_FAILURE,
  CREATE_USER_SUCCESS,
} from './register.actions';

const initialState = {
  username: null,
  address: null,
  error: null,
  redirectToReferrer: false

};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case CREATE_USER_SUCCESS:
      localStorage.setItem('user', JSON.stringify({ "username": action.username, "address": action.address }));
      return {
        username: action.username,
        address: action.address,
        error: null,
        redirectToReferrer: true
      };
    case CREATE_USER_FAILURE:
      localStorage.clear();
      return {
        username: null,
        address: null,
        error: action.error,
        redirectToReferrer: false
      };
    default:
      return state;
  }
};

export default reducer;
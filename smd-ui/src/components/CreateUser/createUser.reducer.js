import {
  CREATE_USER_REQUEST,
  CREATE_USER_FAILURE,
  CREATE_USER_SUCCESS,
  RESET_ERROR
} from './createUser.actions';

const initialState = {
  error: false,
  spinning: false
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case CREATE_USER_REQUEST:
      return {
        spinning: true,
      };
    case CREATE_USER_FAILURE:
      return {
        spinning: false,
        error: action.error
      };
    case CREATE_USER_SUCCESS:
      return {
        spinning: false,
        response: action.response,
        error: false,
      };
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
import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY,
  CREATE_USER_REQUEST,
  CREATE_USER_FAILURE,
  CREATE_USER_SUCCESS,
} from './createUser.actions';

const initialState = {
  isOpen: false,
  compileSuccess: false,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_OVERLAY:
      return {
        isOpen: true,
      };
    case CLOSE_OVERLAY:
      return {
        isOpen: false
      };
    case CREATE_USER_REQUEST:
      return {
        isOpen: true,
        spinning: true,
      };
    case CREATE_USER_FAILURE:
      return {
        isOpen: false,
        spinning: false,
        error: action.error
      };
    case CREATE_USER_SUCCESS:
      return {
        isOpen: false,
        spinning: false,
        response: action.response,
      };
  default:
  return state;
}
};

export default reducer;
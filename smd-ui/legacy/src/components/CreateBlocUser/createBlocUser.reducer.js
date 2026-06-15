import {
  OPEN_OVERLAY,
  CLOSE_OVERLAY,
  CREATE_BLOC_USER_REQUEST,
  CREATE_BLOC_USER_FAILURE,
  CREATE_BLOC_USER_SUCCESS,
} from './createBlocUser.actions';

const initialState = {
  isOpen: false,
  spinning: false,
  key: null
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
    case CREATE_BLOC_USER_REQUEST:
      return {
        isOpen: true,
        spinning: true,
      };
    case CREATE_BLOC_USER_FAILURE:
      return {
        isOpen: false,
        spinning: false,
        error: action.error
      };
    case CREATE_BLOC_USER_SUCCESS:
      return {
        isOpen: false,
        spinning: false,
        key: action.key,
      };
    default:
      return state;
  }
};

export default reducer;
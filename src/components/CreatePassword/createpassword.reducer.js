import {
  OPEN_CREATE_PASSWORD_MODAL,
  CLOSE_CREATE_PASSWORD_MODAL
} from "./createPassword.actions";

const initialState = {
  isOpen: false
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_CREATE_PASSWORD_MODAL:
      return {
        ...state,
        isOpen: true
      }
    case CLOSE_CREATE_PASSWORD_MODAL:
      return {
        ...state,
        isOpen: false
      }
    default:
      return state;
  }
};

export default reducer;
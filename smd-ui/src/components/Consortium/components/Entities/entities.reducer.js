import {
  OPEN_INVITE_ENTITY_MODAL,
  CLOSE_INVITE_ENTITY_MODAL
} from "./entities.actions";

const initialState = {
  isOpen: false
}

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case OPEN_INVITE_ENTITY_MODAL:
      return {
        isOpen: true
      };
    case CLOSE_INVITE_ENTITY_MODAL:
      return {
        isOpen: false
      };
    default:
      return state;
  }
}

export default reducer;
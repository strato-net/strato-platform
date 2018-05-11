import {
  OPEN_INVITE_ENTITY_MODAL,
  CLOSE_INVITE_ENTITY_MODAL,
  FETCH_ENTITES_SUCCESS,
  FETCH_ENTITES_FAILURE
} from "./entities.actions";

const initialState = {
  isOpen: false,
  entities: []
};

const reducer = function(state = initialState, action) {
  switch (action.type) {
    case OPEN_INVITE_ENTITY_MODAL:
      return {
        ...state,
        isOpen: true
      };
    case CLOSE_INVITE_ENTITY_MODAL:
      return {
        ...state,
        isOpen: false
      };
    case FETCH_ENTITES_SUCCESS:
      return {
        ...state,
        entities: action.entities,
        error: null
      };
    case FETCH_ENTITES_FAILURE:
      return {
        ...state,
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;

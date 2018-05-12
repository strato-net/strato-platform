import {
  OPEN_INVITE_ENTITY_MODAL,
  CLOSE_INVITE_ENTITY_MODAL,
  FETCH_ENTITES_SUCCESS,
  FETCH_ENTITES_FAILURE,
  INVITE_ENTITY_REQUEST,
  INVITE_ENTITY_SUCCESS,
  INVITE_ENTITY_FAILURE,
  RESET_ERROR
} from "./entities.actions";

const initialState = {
  isOpen: false,
  entities: [],
  error: null,
  isEntityCreated: false,
  message: null
};

const reducer = function (state = initialState, action) {
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
    case INVITE_ENTITY_REQUEST:
      return {
        ...state,
        message: null,
      }
    case INVITE_ENTITY_SUCCESS:
      return {
        ...state,
        isOpen: false,
        message: 'Entity created',
        isEntityCreated: action.isEntityCreated
      }
    case INVITE_ENTITY_FAILURE:
      return {
        ...state,
        isOpen: true,
        isEntityCreated: false,
        message: action.error,
      }
    case RESET_ERROR:
      return { 
        ...state,
        message: null
      }
    default:
      return state;
  }
};

export default reducer;

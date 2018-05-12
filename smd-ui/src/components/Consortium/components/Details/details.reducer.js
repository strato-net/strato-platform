import { FETCH_ENTITY_SUCCESS, FETCH_ENTITY_FAILURE } from "./details.actions";

const initialState = {
  entity: null,
  error: null
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_ENTITY_SUCCESS:
      return {
        ...state,
        entity: action.entity
      };
    case FETCH_ENTITY_FAILURE:
      return {
        ...state,
        entity: null,
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;
import {
  ADD_CONSORTIUM_INFORMATION,
  ADD_ENTITY,
  CREATE_CONSORTIUM_REQUEST,
  CREATE_CONSORTIUM_SUCCESS,
  CREATE_CONSORTIUM_FAILURE,
} from './createConsortium.actions';

const initialState = {
  newConsortium: { entities: [] },
  consortium: [],
  spinning: false,
  error: null,
};

const reducer = function (state = initialState, action) {
  let consortium;
  switch (action.type) {
    case ADD_CONSORTIUM_INFORMATION:
      consortium = state.newConsortium;
      consortium.id = action.id;
      consortium.addEntityRules = action.addEntityRules;
      consortium.removeEntityRules = action.removeEntityRules;
      return {
        ...state,
        newConsortium: consortium
      };
    case ADD_ENTITY:
      consortium = state.newConsortium;
      consortium.entities.push(action.entity);
      return {
        ...state,
        newConsortium: consortium
      }
    case CREATE_CONSORTIUM_REQUEST:
      return {
        ...state,
        spinning: true,
        error: null,
      }
    case CREATE_CONSORTIUM_SUCCESS:
      consortium = state.consortium;
      consortium.push(action.consortium);
      return {
        error: null,
        spinning: false,
        newConsortium: { entities: [] },
        consortium,
      }
    case CREATE_CONSORTIUM_FAILURE:
      return {
        ...state,
        error: action.error,
        spinning: false,
      }

    default:
      return state;
  }
};

export default reducer;
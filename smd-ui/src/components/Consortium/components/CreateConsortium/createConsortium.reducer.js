import { ADD_CONSORTIUM_INFORMATION, ADD_ENTITY } from './createConsortium.actions';

const initialState = {
  consortium: { entities: [] }
};

const reducer = function (state = initialState, action) {
  let consortium;
  switch (action.type) {
    case ADD_CONSORTIUM_INFORMATION:
      consortium = state.consortium;
      consortium.id = action.id;
      consortium.addEntityRules = action.addEntityRules;
      consortium.removeEntityRules = action.removeEntityRules;
      return {
        ...state,
        consortium
      };
    case ADD_ENTITY:
      consortium = state.consortium;
      consortium.entities.push(action.entity);
      return {
        ...state,
        consortium
      }
    default:
      return state;
  }
};

export default reducer;
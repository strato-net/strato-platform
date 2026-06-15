import {
  METHOD_CALL_REQUEST,
  METHOD_CALL_SUCCESS,
  METHOD_CALL_FAILURE
} from './contractMethodCall.actions';

const initialState = {
  modals: {}
};


const reducer = function (state = initialState, action) {
  switch (action.type) {
    case METHOD_CALL_REQUEST:
      return {
        modals: {
          ...state.modals,
          [action.key]: {
            ...state.modals[action.key],
            loading: true,
          }
        }
      }
    case METHOD_CALL_SUCCESS:
      return {
        modals: {
          ...state.modals,
          [action.key]: {
            ...state.modals[action.key],
            loading: false,
            result: action.result
          }
        }
      }
    case METHOD_CALL_FAILURE:
      return {
        modals: {
          ...state.modals,
          [action.key]: {
            ...state.modals[action.key],
            loading: false,
            result: action.result
          }
        }
      }
    default:
      return state;
  }
}

export default reducer;

import {
  METHOD_CALL_CLOSE_MODAL,
  METHOD_CALL_OPEN_MODAL,
  METHOD_CALL_FETCH_ARGS_SUCCESS,
  METHOD_CALL_FETCH_ARGS_FAILURE
} from './contractMethodCall.actions';

const initialState = {
  modals: {}
};


const reducer = function (state = initialState, action) {
  switch (action.type) {
    case METHOD_CALL_OPEN_MODAL:
      return {
        modals: {
          ...state.modals,
          [action.key] :  {
            ...state.modals[action.key],
            isOpen: true
          }
        }
      }
    case METHOD_CALL_CLOSE_MODAL:
      return {
        ...state.modals,
        [action.key] : {
          ...state.modals[action.key],
          isOpen: false
        }
      }
    case METHOD_CALL_FETCH_ARGS_SUCCESS:
      return {
        modals: {
          ...state.modals,
          [action.key] :  {
            ...state.modals[action.key],
            args: action.args
          }
        }
      }
    case METHOD_CALL_FETCH_ARGS_FAILURE:
      return {
        modals: {
          ...state.modals,
          [action.key] :  {
            ...state.modals[action.key],
            error: action.error
          }
        }
      }
    default:
      return state;
  }
}

export default reducer;

import {
  METHOD_CALL_CLOSE_MODAL,
  METHOD_CALL_OPEN_MODAL,
  METHOD_CALL_FETCH_ARGS_SUCCESS,
  METHOD_CALL_FETCH_ARGS_FAILURE,
  METHOD_CALL_REQUEST,
  METHOD_CALL_SUCCESS,
  METHOD_CALL_FAILURE
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
          [action.key]: {
            ...state.modals[action.key],
            isOpen: true,
            result: 'Waiting for method to be called...'
          }
        }
      }
    case METHOD_CALL_CLOSE_MODAL:
      return {
        modals: {
          ...state.modals,
          [action.key]: {
            ...state.modals[action.key],
            isOpen: false
          }
        }
      }
    case METHOD_CALL_FETCH_ARGS_SUCCESS:
      return {
        modals: {
          ...state.modals,
          [action.key]: {
            ...state.modals[action.key],
            args: action.args,
            isPayable: action.isPayable
          }
        }
      }
    case METHOD_CALL_FETCH_ARGS_FAILURE:
      return {
        modals: {
          ...state.modals,
          [action.key]: {
            ...state.modals[action.key],
            error: action.error
          }
        }
      }
    case METHOD_CALL_REQUEST:
      return {
        modals: {
          ...state.modals,
          [action.key]: {
            ...state.modals[action.key],
            result: 'Sending transaction...'
          }
        }
      }
    case METHOD_CALL_SUCCESS:
      return {
        modals: {
          ...state.modals,
          [action.key]: {
            ...state.modals[action.key],
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
            result: action.result
          }
        }
      }
    default:
      return state;
  }
}

export default reducer;

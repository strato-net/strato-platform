import {
  EXECUTE_QUERY_FAILURE,
  EXECUTE_QUERY_SUCCESS,
  EXECUTE_QUERY,
  REMOVE_QUERY,
  UPDATE_QUERY,
  CLEAR_QUERY
} from './queryEngine.actions';

import {TRANSACTION_QUERY_TYPES} from './queryTypes';

const initialState = {
  query: {last: 15},
  queryResult: [],
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case UPDATE_QUERY:
      return {
        query: {
          ...state.query,
          [action.queryType] : action.queryTerm,
        },
        queryResult: state.queryResult,
        error: null,
      };
    case CLEAR_QUERY:
      return {
        query: {last: 15},
        queryResult: [],
        error: null,
      };
    case REMOVE_QUERY:
      delete state.query[action.queryType];
      return {
        query: state.query,
        queryResult: state.queryResult,
        error: null,
      };
    case EXECUTE_QUERY_SUCCESS:
      return {
        query: state.query,
        queryResult: action.queryResult,
        error: null
      };
    case EXECUTE_QUERY_FAILURE:
      return {
        query: state.query,
        queryResult: [],
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;

import {
  EXECUTE_QUERY_FAILURE,
  EXECUTE_QUERY_SUCCESS,
  REMOVE_QUERY,
  UPDATE_QUERY,
  CLEAR_QUERY,
  TRANSACTION_RESULT_SUCCESS,
  TRANSACTION_RESULT_FAILURE
} from './queryEngine.actions';

import {TRANSACTION_QUERY_TYPES} from './queryTypes';

const initialState = {
  query: {last: 15},
  queryResult: [],
  error: null,
  txResult : null
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case UPDATE_QUERY:
      if (action.queryType === TRANSACTION_QUERY_TYPES.default.key) {
        return state;
      }
      return {
        ...state,
        query: {
          ...state.query,
          [action.queryType] : action.queryTerm,
        },
        queryResult: state.queryResult,
        error: null,
      };
    case CLEAR_QUERY:
      return {
        ...state,
        query: {last: 15},
        queryResult: [],
        error: null,
      };
    case REMOVE_QUERY:
      const newQuery = {}
      Object.getOwnPropertyNames(state.query).forEach((queryType) => {
        if (queryType !== action.queryType)
          newQuery[queryType] = state.query[queryType];
      });
      return {
        ...state,
        query: newQuery,
        queryResult: state.queryResult,
        error: null,
      };
    case EXECUTE_QUERY_SUCCESS:
      let result = action.queryResult;
      // Not sure what this is for but seems to be preventing
      // all results from being displayed when last > 15
      // if (state.query.last) {
      //   result = result.slice(stat);
      // }
      return {
        ...state,
        query: state.query,
        queryResult: result,
        error: null
      };
    case EXECUTE_QUERY_FAILURE:
      return {
        ...state,
        query: state.query,
        queryResult: [],
        error: action.error
      };
    case TRANSACTION_RESULT_SUCCESS:
      const r = action.txResult && ((typeof action.txResult) == 'string') ? `${action.txResult[0].toUpperCase()}${action.txResult.substring(1)}` : action.txResult.type.tag;
      return {
        ...state,
        error : null,
        txResult : r,
        txResultMessage: action.txResult.details
      };
    case TRANSACTION_RESULT_FAILURE:
      return {
        ...state,
        error : action.error,
        txResult : null
      };
    default:
      return state;
  }
};

export default reducer;

import {
  EXECUTE_QUERY_FAILURE,
  EXECUTE_QUERY_SUCCESS,
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
      if (action.queryType === TRANSACTION_QUERY_TYPES.default.key) {
        return state;
      }
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
      const newQuery = {}
      Object.getOwnPropertyNames(state.query).forEach((queryType) => {
        if (queryType !== action.queryType)
          newQuery[queryType] = state.query[queryType];
      });
      return {
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
        query: state.query,
        queryResult: result,
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

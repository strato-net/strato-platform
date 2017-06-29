import {
  ADD_QUERY
} from './transactionTable.actions';

const initialState = {
  queries: {},
  queryTypes: {
    "blockNumber" : "Block Number",
    "transactionType" : "Transaction Type",
    "hash" : "Hash",
    "kind" : "Kind",
    "data" : "Data",
    "to" : "To",
    "value" : "Value",
    "from" : "From",
    "r" : "R",
    "s" : "S",
    "v" : "V",
    "nonce" : "Nonce"
  },
  error: null,
};

const reducer = function (state = initialState, action) {
  console.log(state);
  switch (action.type) {
    case ADD_QUERY:
      const newQueries = {...state.queries, [action.queryType] : [action.queryTerm]};
      return {
        queries: newQueries,
        tx: state.tx.filter(function(transaction) {
          let keep = true;
          Object.getOwnPropertyNames(state.queries).forEach(function(query) {
            keep = keep && transaction[query].toString().includes(state.queries[query])
          });
          return keep && transaction[action.queryType].toString().includes(action.queryTerm);
        }),
        queryTypes: state.queryTypes,
        error: null,
      };
    default:
      return state;
  }
};

export default reducer;

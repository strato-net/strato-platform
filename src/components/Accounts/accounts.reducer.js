import {
  FETCH_ACCOUNTS,
  FETCH_ACCOUNTS_SUCCESS,
  FETCH_ACCOUNTS_FAILURE,
} from './accounts.actions';

const initialState = {
  accounts: [],
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_ACCOUNTS:
      return {
        accounts: state.accounts,
        error: null,
      };
    case FETCH_ACCOUNTS_SUCCESS:
      return {
        accounts: action.accounts,
        error: null,
      };
    case FETCH_ACCOUNTS_FAILURE:
      return {
        accounts: state.accounts,
        error: action.error
      };
    default:
      return state;
  }
};

export default reducer;

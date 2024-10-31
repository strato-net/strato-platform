import {
  FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS,
  FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE,
  RESET_OAUTH_USER_ACCOUNT,
  FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST,
  OAUTH_ACCOUNTS_FILTER
} from './oauthAccounts.actions';

const initialState = {
  account: null,
  name: null,
  error: null,
  filter: '',
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST:
      return {
        ...state,
        name: action.name
      };
    case FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS:
      return {
        ...state,
        account: action.account,
        error: null
      };
    case FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE:
      return {
        ...state,
        account: null,
        error: action.error
      };
    case RESET_OAUTH_USER_ACCOUNT:
      return {
        ...state,
        account: null,
        error: null,
        name: null
      };
    case OAUTH_ACCOUNTS_FILTER:
      return {
        ...state,
        filter: action.filter
      }
    default:
      return state;
  }
};

export default reducer;

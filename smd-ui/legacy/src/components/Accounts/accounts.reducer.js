import {
  FETCH_ACCOUNTS,
  FETCH_ACCOUNTS_SUCCESSFULL,
  FETCH_ACCOUNTS_FAILED,
  CHANGE_ACCOUNT_FILTER,
  FETCH_USER_ADDRESSES_SUCCESSFUL,
  FETCH_USER_ADDRESSES_FAILED,
  FETCH_ACCOUNT_DETAIL_SUCCESS,
  FETCH_ACCOUNT_DETAIL_FAILURE,
  RESET_ACCOUNT_ADDRESS,
  BALANCE_SUCCESS,
  BALANCE_FAILURE,
  FETCH_CURRENT_ACCOUNT_DETAIL_SUCCESS,
  FETCH_CURRENT_ACCOUNT_DETAIL_FAILURE,
  FETCH_OAUTH_ACCOUNTS_SUCCESS,
  FETCH_OAUTH_ACCOUNTS_FAILURE
} from './accounts.actions';

const initialState = {
  accounts: {},
  currentAccountDetail: null,
  filter: '',
  error: null,
  oauthAccounts: []
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_ACCOUNTS:
      return {
        ...state,
        accounts: state.accounts,
        filter: state.filter,
        error: null,
        currentUserBalance: state.currentUserBalance
      };
    case FETCH_ACCOUNTS_SUCCESSFULL:
      const accounts = action.accounts.reduce(function (result, item) {
        result[item] = {};
        return result;
      }, {});
      return {
        ...state,
        accounts: accounts,
        filter: state.filter,
        error: null,
      };
    case FETCH_ACCOUNTS_FAILED:
      return {
        ...state,
        accounts: state.accounts,
        filter: state.filter,
        error: action.error
      };
    case CHANGE_ACCOUNT_FILTER:
      return {
        ...state,
        accounts: state.accounts,
        filter: action.filter,
        error: state.error,
      }
    case FETCH_USER_ADDRESSES_SUCCESSFUL:
      const addresses = action.addresses.reduce(function (result, address) {
        result[address] = {
          error: null
        }
        return result;
      }, {})
      return {
        ...state,
        accounts: {
          ...state.accounts,
          [action.name]: addresses
        },
        filter: state.filter,
        error: state.error,
        currentUserBalance: state.currentUserBalance
      }
    case FETCH_USER_ADDRESSES_FAILED:
      return {
        ...state,
        accounts: {
          ...state.accounts,
          [action.name]: {
            error: action.error
          }
        },
        filter: state.filter,
        error: state.error,
        currentUserBalance: state.currentUserBalance
      }
    case FETCH_ACCOUNT_DETAIL_SUCCESS:
      return {
        ...state,
        accounts: {
          ...state.accounts,
          [action.name]: {
            ...state.accounts[action.name],
            [action.address]: {
              ...action.detail,
              error: null
            }
          }
        },
        filter: state.filter,
        error: state.error,
        currentUserBalance: state.currentUserBalance
      }
    case RESET_ACCOUNT_ADDRESS:
      return {
        ...state,
        accounts: {
          ...state.accounts,
          [action.name]: {}
        },
        filter: state.filter,
        error: state.error
      }
    case FETCH_ACCOUNT_DETAIL_FAILURE:
      return {
        ...state,
        accounts: {
          ...state.accounts,
          [action.name]: {
            ...state.accounts[action.name],
            [action.address]: {
              error: action.error
            }
          }
        },
        filter: state.filter,
        error: state.error,
        currentUserBalance: state.currentUserBalance
      }
    case BALANCE_SUCCESS:
      return {
        ...state,
        currentUserBalance: action.detail && action.detail.balance
      }
    case BALANCE_FAILURE:
      return {
        ...state,
        currentUserBalance: null
      }
    case FETCH_CURRENT_ACCOUNT_DETAIL_SUCCESS:
      return {
        ...state,
        currentAccountDetail: action.detail,
        error: null
      }
    case FETCH_CURRENT_ACCOUNT_DETAIL_FAILURE:
      return {
        ...state,
        currentAccountDetail: null,
        error: action.error
      }
    case FETCH_OAUTH_ACCOUNTS_SUCCESS:
      return {
        ...state,
        oauthAccounts: action.data
      }
    case FETCH_OAUTH_ACCOUNTS_FAILURE:
      return {
        ...state,
        oauthAccounts: [],
        error: action.error
      }
    default:
      return state;
  }
};

export default reducer;

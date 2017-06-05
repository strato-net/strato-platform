import {
  FETCH_ACCOUNTS,
  FETCH_ACCOUNTS_SUCCESS,
  FETCH_ACCOUNTS_FAILURE,
  CHANGE_ACCOUNT_FILTER,
  FETCH_USER_ADDRESSES_SUCCESS,
  FETCH_USER_ADDRESSES_FAILURE,
  FETCH_ACCOUNT_DETAIL_SUCCESS,
  FETCH_ACCOUNT_DETAIL_FAILURE
} from './accounts.actions';

const initialState = {
  accounts: [],
  filter: '',
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_ACCOUNTS:
      return {
        accounts: state.accounts,
        filter: state.filter,
        error: null,
      };
    case FETCH_ACCOUNTS_SUCCESS:
      return {
        accounts: action.accounts,
        filter: state.filter,
        error: null,
      };
    case FETCH_ACCOUNTS_FAILURE:
      return {
        accounts: state.accounts,
        filter: state.filter,
        error: action.error
      };
    case CHANGE_ACCOUNT_FILTER:
      return {
        accounts: state.accounts,
        filter: action.filter,
        error: state.error,
      }
    case FETCH_USER_ADDRESSES_SUCCESS:
      const addresses = action.addresses.reduce(function(result, address){
        result[address] = {
          error: null
        }
        return result;
      }, {})
      return {
        accounts: {
          ...state.accounts,
          [action.name]: addresses
        },
        filter: state.filter,
        error: state.error
      }
    case FETCH_USER_ADDRESSES_FAILURE:
      return {
        accounts: {
          ...state.accounts,
          [action.name]: {
            error: action.error
          }
        },
        filter: state.filter,
        error: state.error
      }
    case FETCH_ACCOUNT_DETAIL_SUCCESS:
      return {
        accounts: {
          ...state.accounts,
          [action.name]: {
            ...state.accounts[action.name],
            [action.address] : {
              ...action.detail,
              error: null
            }
          }
        },
        filter: state.filter,
        error: state.error
      }
    case FETCH_ACCOUNT_DETAIL_FAILURE:
      return {
        accounts: {
          ...state.accounts,
          [action.name]: {
            ...state.accounts[action.name],
            [action.address] : {
              error: action.error
            }
          }
        },
        filter: state.filter,
        error: state.error
      }
    default:
      return state;
  }
};

export default reducer;

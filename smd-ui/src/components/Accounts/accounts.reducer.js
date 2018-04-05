import {
  FETCH_ACCOUNTS,
  FETCH_ACCOUNTS_SUCCESSFULL,
  FETCH_ACCOUNTS_FAILED,
  CHANGE_ACCOUNT_FILTER,
  FETCH_USER_ADDRESSES_SUCCESSFUL,
  FETCH_USER_ADDRESSES_FAILED,
  FETCH_ACCOUNT_DETAIL_SUCCESS,
  FETCH_ACCOUNT_DETAIL_FAILURE,
  RESET_ACCOUNT_ADDRESS
} from './accounts.actions';

const initialState = {
  accounts: {},
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
    case FETCH_ACCOUNTS_SUCCESSFULL:
      const accounts = action.accounts.reduce(function(result, item){
        result[item] = {};
        return result;
      }, {});
      return {
        accounts: accounts,
        filter: state.filter,
        error: null,
      };
    case FETCH_ACCOUNTS_FAILED:
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
    case FETCH_USER_ADDRESSES_SUCCESSFUL:
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
    case FETCH_USER_ADDRESSES_FAILED:
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
    case RESET_ACCOUNT_ADDRESS: 
      return {
        accounts: {
          ...state.accounts,
          [action.name]: {}
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

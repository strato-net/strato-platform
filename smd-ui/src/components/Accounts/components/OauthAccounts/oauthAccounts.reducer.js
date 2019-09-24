import {
  FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS,
  FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE,
  RESET_OAUTH_USER_ACCOUNT,
  FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST,
  OAUTH_FAUCET_REQUEST,
  OAUTH_FAUCET_SUCCESS,
  OAUTH_FAUCET_FAILURE
} from './oauthAccounts.actions';

const initialState = {
  account: null,
  name: null,
  error: null,
  faucet: {
    status: false,
    accountAddress: null
  },
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
    case OAUTH_FAUCET_REQUEST:
      return {
        ...state,
        faucet: {
          status: true,
          accountAddress: action.address
        }
      }
    case OAUTH_FAUCET_SUCCESS:
      return {
        ...state,
        faucet: {
          status: false,
          accountAddress: null
        }
      }
    case OAUTH_FAUCET_FAILURE:
      return {
        ...state,
        faucet: {
          status: false,
          accountAddress: null
        }
      }
    default:
      return state;
  }
};

export default reducer;

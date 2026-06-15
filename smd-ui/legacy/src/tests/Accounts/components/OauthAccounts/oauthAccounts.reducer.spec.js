import reducer from '../../../../components/Accounts/components/OauthAccounts/oauthAccounts.reducer';
import {
  fetchOauthAccountDetail,
  fetchOauthAccountDetailSuccess,
  fetchOauthAccountDetailFailure,
  resetOauthUserAccount,
  oauthAccountsFilter
} from '../../../../components/Accounts/components/OauthAccounts/oauthAccounts.actions';
import { error, oauthAccounts, filter } from "../../accountsMock";

describe('OauthAccounts: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('fetch Oauth account details', () => {

    // FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST
    test('on request', () => {
      const data = {
        name: oauthAccounts[0].username,
        address: oauthAccounts[0].address,
        chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9"
      }

      const action = fetchOauthAccountDetail(data.name, data.address, data.chainId);

      const initialState = {
        account: null,
        name: null,
        error: null,
        filter: '',
        faucet: {
          status: false,
          accountAddress: null
        },
      };

      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS
    test('on success', () => {

      const action = fetchOauthAccountDetailSuccess(oauthAccounts[0]);

      const initialState = {
        account: null,
        name: null,
        error: null,
        filter: '',
        faucet: {
          status: false,
          accountAddress: null
        },
      };

      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE
    test('on failure', () => {

      const action = fetchOauthAccountDetailFailure(error);

      const initialState = {
        account: null,
        name: null,
        error: null,
        filter: '',
        faucet: {
          status: false,
          accountAddress: null
        },
      };

      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

   // RESET_OAUTH_USER_ACCOUNT
   test('resetOauthUserAccount', () => {

    const action = resetOauthUserAccount(error);

    const initialState = {
      account: oauthAccounts[0],
      name: oauthAccounts[0].username,
      error: null,
      filter: '',
      faucet: {
        status: false,
        accountAddress: null
      },
    };

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

   // OAUTH_ACCOUNTS_FILTER
   test('oauthAccountsFilter', () => {

    const action = oauthAccountsFilter(filter);

    const initialState = {
      account: null,
      name: null,
      error: null,
      filter: '',
      faucet: {
        status: false,
        accountAddress: null
      },
    };

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

});

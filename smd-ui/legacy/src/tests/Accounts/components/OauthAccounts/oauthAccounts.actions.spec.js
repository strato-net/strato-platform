import {
  fetchOauthAccountDetail,
  fetchOauthAccountDetailSuccess,
  fetchOauthAccountDetailFailure,
  resetOauthUserAccount,
  oauthAccountsFilter
} from '../../../../components/Accounts/components/OauthAccounts/oauthAccounts.actions';
import { error, oauthAccounts, filter } from '../../accountsMock';

describe('OauthAccounts: action', () => {

  describe('fetch Oauth account detail', () => {

    test('request', () => {
      const data = {
        name: oauthAccounts[0].username,
        address: oauthAccounts[0].address,
        chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9"
      }
      expect(fetchOauthAccountDetail(data.name, data.address, data.chainId)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchOauthAccountDetailSuccess(oauthAccounts[0])).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchOauthAccountDetailFailure(error)).toMatchSnapshot();
    });

  })

  test('resetOauthUserAccount', () => {
    expect(resetOauthUserAccount()).toMatchSnapshot();
  });

  test('oauthAccountsFilter', () => {
    expect(oauthAccountsFilter(filter)).toMatchSnapshot();
  });

});

import reducer from '../../components/Accounts/accounts.reducer';
import {
  fetchAccounts,
  fetchAccountsSuccess,
  fetchAccountsFailure,
  changeAccountFilter,
  fetchUserAddressesSuccess,
  fetchUserAddressesFailure,
  fetchAccountDetailSuccess,
  fetchAccountDetailFailure
} from '../../components/Accounts/accounts.actions';
import { deepClone } from '../helper/testHelper';
import { accountsMock, reducerAccounts, filter, error, accountDetail } from "./accountsMock";

describe('Accounts: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('fetch accounts', () => {

    // FETCH_ACCOUNTS
    test('on request', () => {
      const action = fetchAccounts();
      const initialState = {
        accounts: {},
        filter: ''
      };
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_ACCOUNTS_SUCCESSFULL
    test('on success', () => {
      const action = fetchAccountsSuccess(accountsMock);
      const initialState = {
        accounts: {},
        filter: ''
      };
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_ACCOUNTS_FAILED
    test('on failure', () => {
      const action = fetchAccountsFailure(error);
      const initialState = {
        accounts: {},
        filter: '',
        error
      };
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  })

  // CHANGE_ACCOUNT_FILTER
  test('update accounts filter', () => {
    const action = changeAccountFilter(filter);
    const initialState = {
      accounts: reducerAccounts,
      filter: '',
      error: null
    };
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  describe('fetch user address', () => {

    // FETCH_USER_ADDRESSES_SUCCESSFUL
    test('on success', () => {
      const data = {
        name: 'tanuj',
        addresses: ["60122a032bebcb89e228899b60c4d190b5a17aa3", "45b53a8b688c3a3faca30e5842800922f80fdb8d"]
      }
      const action = fetchUserAddressesSuccess(data.name, data.addresses);
      const initialState = {
        accounts: reducerAccounts,
        filter: '',
        error: null
      };
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_USER_ADDRESSES_FAILED
    test('on failure', () => {
      const data = {
        name: 'tanuj',
        error
      }
      const action = fetchUserAddressesFailure(data.name, data.error);
      const initialState = {
        accounts: reducerAccounts,
        filter: '',
        error: null
      };
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  })

  describe('fetch account details', () => {

    // FETCH_ACCOUNT_DETAIL_SUCCESSFULL
    test('on success', () => {
      const data = {
        name: 'tanuj',
        address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03'
      }
      const action = fetchAccountDetailSuccess(data.name, data.address, accountDetail);
      const initialState = {
        accounts: reducerAccounts,
        filter: '',
        error: null
      };
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_ACCOUNT_DETAIL_FAILED
    test('on failure', () => {
      const data = {
        name: 'tanuj',
        address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03',
        error
      }
      const action = fetchAccountDetailFailure(data.name, data.address, data.error);
      const initialState = {
        accounts: reducerAccounts,
        filter: '',
        error: null
      };
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  })

});

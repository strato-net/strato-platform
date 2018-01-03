import React from 'react';
import Accounts, { mapStateToProps } from '../../components/Accounts/index';
import { error, accountsMock, filter, reducerAccounts, indexAccountsMock } from './accountsMock';
import { deepClone } from '../helper/testHelper';

describe('Accounts: index', () => {

  describe('render with', () => {

    test('empty values', () => {
      const props = {
        accounts: [],
        filter: '',
        history: {},
        fetchAccounts: jest.fn(),
        changeAccountFilter: jest.fn(),
        faucetRequest: jest.fn()
      }
      const wrapper = shallow(
        <Accounts.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

    test('mocked values', () => {
      const props = {
        accounts: indexAccountsMock,
        filter: '',
        history: {},
        fetchAccounts: jest.fn(),
        changeAccountFilter: jest.fn(),
        faucetRequest: jest.fn()
      }
      const wrapper = shallow(
        <Accounts.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

  })

  test('invoke faucet on click', () => {
    const props = {
      accounts: indexAccountsMock,
      filter: '',
      history: {},
      fetchAccounts: jest.fn(),
      changeAccountFilter: jest.fn(),
      faucetRequest: jest.fn()
    }
    const wrapper = shallow(
      <Accounts.WrappedComponent {...props} />
    );
    wrapper.find('button').at(0).simulate('click', { stopPropagation() { }, preventDefault() { } });
    expect(props.faucetRequest).toHaveBeenCalled();
  });

  test('change history on account click', () => {
    const props = {
      accounts: indexAccountsMock,
      filter: '',
      history: { push: jest.fn() },
      fetchAccounts: jest.fn(),
      changeAccountFilter: jest.fn(),
      faucetRequest: jest.fn()
    }
    const wrapper = shallow(
      <Accounts.WrappedComponent {...props} />
    );
    wrapper.find('tr').at(5).simulate('click');
    expect(props.history.push).toHaveBeenCalled();
  });

  test('invoke onchange on input and trigger changeAccountFilter', () => {
    const props = {
      accounts: indexAccountsMock,
      filter: '',
      history: { push: jest.fn() },
      fetchAccounts: jest.fn(),
      changeAccountFilter: jest.fn(),
      faucetRequest: jest.fn()
    }
    const wrapper = shallow(
      <Accounts.WrappedComponent {...props} />
    );
    wrapper.find('input').simulate('change', { target: { name: "pollName", value: "spam" } });
    expect(props.changeAccountFilter).toHaveBeenCalled();
  });

  test('componentDidMount', () => {
    const props = {
      accounts: indexAccountsMock,
      filter: filter,
      history: {},
      fetchAccounts: jest.fn(),
      changeAccountFilter: jest.fn(),
      faucetRequest: jest.fn()
    }
    const wrapper = shallow(
      <Accounts.WrappedComponent {...props} />
    );
    expect(props.fetchAccounts).toHaveBeenCalled();
    expect(props.fetchAccounts.mock.calls).toEqual([[true, true]]);
  });

  test('mapStateToProps with default values', () => {
    const state = {
      accounts: {
        accounts: indexAccountsMock,
        filter: filter
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})
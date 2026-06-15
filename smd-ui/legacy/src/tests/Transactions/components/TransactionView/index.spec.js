import React from 'react';
import TransactionView, { mapStateToProps } from '../../../../components/Transactions/components/TransactionView/index';
import { transactionDetail, updatedData } from '../transactionMock';
import { Provider } from 'react-redux';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';

describe('TransactionView', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
  });

  describe('render', () => {

    test('mocked values & store', () => {
      const props = {
        match: { params: { hash: "70018a76a7aa0e6d54565ae22264ac48773a52204c47fd0166b5a6df6e8f2a81" } },
        tx: transactionDetail,
        executeQuery: jest.fn(),
        store: store,
        getTransactionResultRequest : jest.fn(),
        txResult : "success"
      };

      const wrapper = shallow(
        <TransactionView.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

    test('no transaction mock is passed', () => {
      const props = {
        match: { params: { hash: "70018a76a7aa0e6d54565ae22264ac48773a52204c47fd0166b5a6df6e8f2a81" } },
        tx: { timestamp: "2017-12-13 07:47:05.998689 UTC" },
        executeQuery: jest.fn(),
        store: store,
        getTransactionResultRequest : jest.fn(),
        txResult : "success"
      };

      const wrapper = shallow(
        <TransactionView.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

  });

  describe('simulate', () => {

    test('when transaction is empty', () => {
      const props = {
        match: { params: { hash: "70018a76a7aa0e6d54565ae22264ac48773a52204c47fd0166b5a6df6e8f2a81" } },
        tx: null,
        executeQuery: jest.fn(),
        history: { goBack: jest.fn().mockReturnValue('historyUpdated'), push: jest.fn().mockReturnValue('historyPushed') },
        getTransactionResultRequest : jest.fn(),
        txResult : "success"
      };

      const wrapper = mount(
        <Provider store={store}>
          <TransactionView.WrappedComponent {...props} />
        </Provider>
      );

      wrapper.find('Button').simulate('click');
      expect(props.history.goBack()).toBe('historyUpdated');
    });

    test('when transaction has mocked value', () => {
      const props = {
        match: { params: { hash: "70018a76a7aa0e6d54565ae22264ac48773a52204c47fd0166b5a6df6e8f2a81" } },
        tx: transactionDetail,
        executeQuery: jest.fn(),
        history: { goBack: jest.fn().mockReturnValue('historyUpdated') },
        getTransactionResultRequest : jest.fn(),
        txResult : "success"
      };

      const wrapper = mount(
        <Provider store={store}>
          <TransactionView.WrappedComponent {...props} />
        </Provider>
      );

      wrapper.find('Button').simulate('click');
      expect(props.history.goBack()).toBe('historyUpdated');
    });

  })

  describe('mapStateToProps with', () => {

    test('transaction as a state', () => {
      const state = {
        queryEngine: {
          "query": {
            "last": 1
          }
        },
        transactions: {
          tx: updatedData
        },
        chains: {
          selectedChain: '1c8792a7e43d132487500936d946f510e7ff51635838060757bf886828403a14'
        }
      };

      const ownProps = { match: { params: { hash: "70018a76a7aa0e6d54565ae22264ac48773a52204c47fd0166b5a6df6e8f2a81" } } };
      expect(mapStateToProps(state, ownProps)).toMatchSnapshot();
    });

    test('queryEngine as a state', () => {
      const state = {
        transactions: {
          tx: []
        },
        queryEngine: {
          "query": {
            "last": 15
          },
          "queryResult": [
            "70018a76a7aa0e6d54565ae22264ac48773a52204c47fd0166b5a6df6e8f2a81"
          ],
          "error": null
        },
        chains: {
          selectedChain: '1c8792a7e43d132487500936d946f510e7ff51635838060757bf886828403a14'
        }
      };

      const ownProps = { match: { params: { hash: "70018a76a7aa0e6d54565ae22264ac48773a52204c47fd0166b5a6df6e8f2a81" } } };
      expect(mapStateToProps(state, ownProps)).toMatchSnapshot();
    });

  });

});
import React from 'react';
import TransactionView, { mapStateToProps } from '../../../../components/Transactions/components/TransactionView/index';
import { transactionDetail, updatedData } from '../transactionMock';
import { Provider } from 'react-redux';
import configureStore from 'redux-mock-store'
import renderer from 'react-test-renderer';

const mockStore = configureStore([]);

describe('TransactionView', () => {

  describe('render', () => {

    test('mocked values & store', () => {
      const props = {
        match: { params: { hash: "70018a76a7aa0e6d54565ae22264ac48773a52204c47fd0166b5a6df6e8f2a81" } },
        tx: transactionDetail,
        fetchTx: jest.fn()
      }
      const store = mockStore({ state: { Transactions: { tx: updatedData } } });
      const wrapper = render(
        <Provider store={store}>
          <TransactionView.WrappedComponent {...props} />
        </Provider>
      );
      expect(wrapper).toMatchSnapshot();
    });

    test('no transaction mock is passed', () => {
      const props = {
        match: { params: { hash: "70018a76a7aa0e6d54565ae22264ac48773a52204c47fd0166b5a6df6e8f2a81" } },
        tx: null,
        fetchTx: jest.fn()
      }
      const wrapper = render(
        <Provider store={mockStore({})}>
          <TransactionView.WrappedComponent {...props} />
        </Provider>
      );
      expect(wrapper).toMatchSnapshot();
    });

  })

  describe('simulate', () => {

    test('when transaction is empty', () => {
      const props = {
        match: { params: { hash: "70018a76a7aa0e6d54565ae22264ac48773a52204c47fd0166b5a6df6e8f2a81" } },
        tx: null,
        fetchTx: jest.fn(),
        history: { goBack: jest.fn().mockReturnValue('historyUpdated') }
      }
      const wrapper = mount(
        <Provider store={mockStore({})}>
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
        fetchTx: jest.fn(),
        history: { goBack: jest.fn().mockReturnValue('historyUpdated') }
      }
      const wrapper = mount(
        <Provider store={mockStore({})}>
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
        transactions: {
          tx: updatedData
        }
      }
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
        }
      }
      const ownProps = { match: { params: { hash: "70018a76a7aa0e6d54565ae22264ac48773a52204c47fd0166b5a6df6e8f2a81" } } };
      expect(mapStateToProps(state, ownProps)).toMatchSnapshot();
    });

  })

})
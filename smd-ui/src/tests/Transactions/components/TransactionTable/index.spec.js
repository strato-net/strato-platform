import React from 'react'
import TransactionTable, { mapStateToProps } from '../../../../components/Transactions/components/TransactionTable/index'
import { mount } from 'enzyme'
import { reducer as formReducer } from 'redux-form'
import { createStore, combineReducers } from 'redux'
import { Provider } from 'react-redux'
import { transactions } from '../../../TransactionList/transactionListMock'

describe("TransactionTable: index", () => {

  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  })

  test('simulate buttons click', () => {
    const props = {
      query: { last: 15 },
      queryResults: transactions,
      fetchTx: jest.fn(),
      executeQuery: jest.fn(),
      updateQuery: jest.fn(),
      removeQuery: jest.fn(),
      clearQuery: jest.fn(),
      history: { push: jest.fn() }
    }
    let wrapper = mount(
      <Provider store={store}>
        <TransactionTable.WrappedComponent {...props} />
      </Provider>
    )
    wrapper.find('button').at(0).simulate('click');
    expect(props.clearQuery).toHaveBeenCalled();

    wrapper.find('button').at(2).simulate('click');
    expect(props.removeQuery).toHaveBeenCalled();

    wrapper.find('tr').at(2).simulate('click')
    expect(props.history.push).toHaveBeenCalled()

  });

  test('simulate form submit', () => {
    const props = {
      query: {},
      queryResults: transactions,
      fetchTx: jest.fn(),
      executeQuery: jest.fn(),
      updateQuery: jest.fn(),
      removeQuery: jest.fn(),
      clearQuery: jest.fn(),
      handleSubmit: jest.fn(),
      history: { push: jest.fn() }
    }
    let wrapper = mount(
      <Provider store={store}>
        <TransactionTable.WrappedComponent {...props} />
      </Provider>
    )
    const t = wrapper.find('Field').last().simulate('keyPress', { target: { key: 'Enter', value: 'temp' } });
    const test = wrapper.find('Button').last().simulate('click');
    const r = wrapper.find('Form').simulate('submit');
    expect(props.handleSubmit).toHaveBeenCalled();

  });

  test('component methods', () => {
    const props = {
      query: { last: 15 },
      queryResults: [],
      fetchTx: jest.fn(),
      executeQuery: jest.fn().mockReturnValue('executeQuery'),
      updateQuery: jest.fn().mockReturnValue('updateQuery'),
      removeQuery: jest.fn().mockReturnValue('removeQuery'),
      clearQuery: jest.fn().mockReturnValue('clearQuery')
    }
    let wrapper = shallow(
      <Provider store={store}>
        <TransactionTable.WrappedComponent {...props} />
      </Provider>
    ).dive()
    expect(wrapper.instance().props.executeQuery()).toBe('executeQuery');
    expect(wrapper.instance().props.updateQuery()).toBe('updateQuery');
    expect(wrapper.instance().props.removeQuery()).toBe('removeQuery');
    expect(wrapper.instance().props.clearQuery()).toBe('clearQuery');
  });

  test('component did mount', () => {
    const props = {
      query: { last: 15 },
      queryResults: [],
      fetchTx: jest.fn(),
      executeQuery: jest.fn(),
      updateQuery: jest.fn(),
      removeQuery: jest.fn(),
      clearQuery: jest.fn()
    }
    let wrapper = mount(
      <Provider store={store}>
        <TransactionTable.WrappedComponent {...props} />
      </Provider>
    )
    expect(props.fetchTx).toHaveBeenCalled();
  });

  test('mapStateToProps with default state', () => {
    const state = {
      queryEngine: {
        query: { last: 15 },
        queryResults: transactions
      },
      chains: {
        selectedChain: 'airline cartel 1'
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

  test('redux form', () => {
    const props = {
      query: { last: 15 },
      queryResults: [],
      fetchTx: jest.fn(),
      executeQuery: jest.fn(),
      updateQuery: jest.fn(),
      removeQuery: jest.fn(),
      clearQuery: jest.fn(),
      handleSubmit: jest.fn(),
    }

    let wrapper = mount(
      <Provider store={store}>
        <TransactionTable.WrappedComponent {...props} />
      </Provider>, { lifecycleExperimental: true }
    )
    expect(store.getState().form['transaction-query'].values).toBeUndefined()
    const form = wrapper.find('form')
    const select = wrapper.find('Field').first()
    const input = wrapper.find('Field').last()
    expect(input.instance().value).toBe(undefined)
    expect(select.instance().value).toBe(undefined)
    input.simulate('change', { target: { value: '15' } })
    input.simulate('keypress', { key: 'Enter' })
    select.simulate('change', { target: { value: 'BlockNumber' } })
    expect(input.instance().value).toBe('15')
    expect(select.instance().value).toBe('BlockNumber')
    form.simulate('submit')
    expect(store.getState().form['transaction-query'].values).toEqual({ value: '15', query: 'BlockNumber' })

  });

  test('update query method', () => {
    const props = {
      query: { last: 15 },
      queryResults: [],
      fetchTx: jest.fn(),
      executeQuery: jest.fn(),
      updateQuery: jest.fn(),
      removeQuery: jest.fn(),
      clearQuery: jest.fn(),
      handleSubmit: jest.fn(),
      store: store
    }

    let wrapper = shallow(
      <TransactionTable.WrappedComponent {...props} />
    ).dive().dive().dive()
    wrapper.instance().updateQuery({ value: '15', query: 'BlockNumber' })
    expect(props.updateQuery).toHaveBeenCalledWith('BlockNumber', '15')
  });

  test('update query method without any values', () => {
    const props = {
      query: { last: 15 },
      queryResults: [],
      fetchTx: jest.fn(),
      executeQuery: jest.fn(),
      updateQuery: jest.fn(),
      removeQuery: jest.fn(),
      clearQuery: jest.fn(),
      handleSubmit: jest.fn(),
      store: store
    }

    let wrapper = shallow(
      <TransactionTable.WrappedComponent {...props} />
    ).dive().dive().dive()
    wrapper.instance().updateQuery({ value: null, query: null })
    expect(props.updateQuery).not.toHaveBeenCalledWith('BlockNumber', '15')
  });

  test('componentWillReceiveProps', () => {
    const props = {
      query: { last: 15 },
      queryResults: [],
      fetchTx: jest.fn(),
      executeQuery: jest.fn(),
      updateQuery: jest.fn(),
      removeQuery: jest.fn(),
      clearQuery: jest.fn(),
      handleSubmit: jest.fn(),
      store: store
    }
    let wrapper = shallow(
      <TransactionTable.WrappedComponent {...props} />
    ).dive().dive().dive()
    const props2 = {
      query: { last: 10 },
      executeQuery: jest.fn()
    }
    wrapper.instance().componentWillReceiveProps(props2)
    expect(props2.executeQuery).toHaveBeenCalled()
  });

})
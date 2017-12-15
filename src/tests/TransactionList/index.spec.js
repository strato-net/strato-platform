import React from 'react';
import TransactionList, { mapStateToProps } from '../../components/TransactionList/index';
import { data } from './transactionListMock';

describe('Test TransactionList index', () => {

  test('should render transactions with empty values', () => {
    const props = {
      transactions: undefined,
      subscribeRoom: () => { }
    }

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should render transactions with mocked values', () => {
    const props = {
      transactions: data,
      subscribeRoom: () => { },
      unSubscribeRoom: () => { }
    }

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should redirect to transaction detail page', () => {
    const props = {
      transactions: data,
      history: [],
      subscribeRoom: () => { },
      unSubscribeRoom: () => { }
    }

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    wrapper.find('tr').at(1).simulate('click');
    expect(wrapper).toMatchSnapshot();
  });

  test('should invoke componentWillUnmount', () => {
    const props = {
      transactions: data,
      history: [],
      subscribeRoom: () => { },
      unSubscribeRoom: () => { }
    }

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    wrapper.instance().componentWillUnmount();
    expect(wrapper).toMatchSnapshot();
  });

  test('should test component functions', () => {
    const props = {
      transactions: data,
      subscribeRoom: jest.fn().mockReturnValue('subscribeRoom'),
      unSubscribeRoom: jest.fn().mockReturnValue('unSubscribeRoom')
    }

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    expect(wrapper.instance().props.subscribeRoom()).toBe('subscribeRoom');
    expect(wrapper.instance().props.unSubscribeRoom()).toBe('unSubscribeRoom');
  });

  test('test mapStateToProps function', () => {
    const state = {
      transactions: {
        transactions: ''
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})
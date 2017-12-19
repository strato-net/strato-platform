import React from 'react';
import TransactionList, { mapStateToProps } from '../../components/TransactionList/index';
import { transactions, unSubscribeRoomMock, subscribeMock, subscribeRoomMock } from './transactionListMock';

describe('Test TransactionList index', () => {

  test('should render transactions with empty values', () => {
    const props = {
      transactions: [],
      subscribeRoom: () => { }
    }

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should render transactions with mocked values', () => {
    const props = {
      transactions,
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
      transactions,
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
      transactions,
      history: [],
      subscribeRoom: () => { },
      unSubscribeRoom: jest.fn()
    }

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    wrapper.instance().componentWillUnmount();
    expect(props.unSubscribeRoom).toHaveBeenCalled();
    expect(props.unSubscribeRoom.mock.calls).toEqual(unSubscribeRoomMock);
  });

  test('should invoke subscribeRoom on componentDidMount', () => {
    const props = {
      transactions,
      history: [],
      subscribeRoom: jest.fn()
    }

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    expect(props.subscribeRoom).toHaveBeenCalled();
    expect(props.subscribeRoom.mock.calls).toEqual(subscribeRoomMock);
  });

  test('should test component functions', () => {
    const props = {
      transactions,
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
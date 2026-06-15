import React from 'react';
import TransactionList, { mapStateToProps } from '../../components/TransactionList/index';
import { transactions, unSubscribeRoomMock, subscribeMock, subscribeRoomMock } from './transactionListMock';

describe('TransactionList: index', () => {

  describe('render component', () => {
    test('without value', () => {
      const props = {
        transactions: [],
        subscribeRoom: jest.fn()
      };

      const wrapper = shallow(
        <TransactionList.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        transactions,
        subscribeRoom: jest.fn(),
        unSubscribeRoom: jest.fn()
      };

      const wrapper = shallow(
        <TransactionList.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });
  });

  test('redirect to transaction detail page', () => {
    const props = {
      transactions,
      history: [],
      subscribeRoom: jest.fn(),
      unSubscribeRoom: jest.fn()
    }

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    wrapper.find('tr').at(1).simulate('click');
    expect(wrapper).toMatchSnapshot();
  });

  test('componentWillUnmount', () => {
    const props = {
      transactions,
      history: [],
      subscribeRoom: jest.fn(),
      unSubscribeRoom: jest.fn()
    };

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    wrapper.unmount();
    expect(props.unSubscribeRoom).toHaveBeenCalled();
    expect(props.unSubscribeRoom.mock.calls).toEqual(unSubscribeRoomMock);
  });

  test('componentDidMount', () => {
    const props = {
      transactions,
      history: [],
      subscribeRoom: jest.fn()
    };

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    expect(props.subscribeRoom).toHaveBeenCalled();
    expect(props.subscribeRoom.mock.calls).toEqual(subscribeRoomMock);
  });

  test('component functions', () => {
    const props = {
      transactions,
      subscribeRoom: jest.fn().mockReturnValue('subscribeRoom'),
      unSubscribeRoom: jest.fn().mockReturnValue('unSubscribeRoom')
    };

    const wrapper = shallow(
      <TransactionList.WrappedComponent {...props} />
    );

    expect(wrapper.instance().props.subscribeRoom()).toBe('subscribeRoom');
    expect(wrapper.instance().props.unSubscribeRoom()).toBe('unSubscribeRoom');
  });

  test('mapStateToProps', () => {
    const state = {
      transactions: {
        transactions: ''
      }
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});
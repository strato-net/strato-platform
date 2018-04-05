import React from 'react';
import Dashboard, { mapStateToProps } from '../../components/Dashboard/index';
import {
  dashboard,
  node,
  unSubscribeRoomMock,
  subscribeRoomMock
} from './dashboardMock';

describe('Dashboard: index', () => {

  describe('render component', () => {

    test('without values', () => {
      const props = {
        dashboard: {
          "transactionsCount": [],
          "blockPropagation": [],
          "blockDifficulty": [],
          "transactionTypes": []
        },
        node: {
          "name": "LOCALHOST",
          "peers": {},
          "coinbase": ""
        },
        subscribeRoom: jest.fn(),
        unSubscribeRoom: jest.fn()
      }
      const wrapper = shallow(
        <Dashboard.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        dashboard,
        node,
        subscribeRoom: jest.fn(),
        unSubscribeRoom: jest.fn()
      };
      const wrapper = shallow(
        <Dashboard.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

  });

  test('valid functions as a props', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: jest.fn().mockReturnValue('subscribeRoom'),
      unSubscribeRoom: jest.fn().mockReturnValue('unSubscribeRoom')
    };
    const wrapper = shallow(
      <Dashboard.WrappedComponent {...props} />
    );
    expect(wrapper.instance().props.subscribeRoom()).toBe('subscribeRoom');
    expect(wrapper.instance().props.unSubscribeRoom()).toBe('unSubscribeRoom');
  });

  test('componentWillUnmount', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: jest.fn(),
      unSubscribeRoom: jest.fn()
    };
    const wrapper = shallow(
      <Dashboard.WrappedComponent {...props} />
    );
    wrapper.unmount();
    expect(props.unSubscribeRoom).toHaveBeenCalled();
    expect(props.unSubscribeRoom.mock.calls).toEqual(unSubscribeRoomMock);
    expect(wrapper).toMatchSnapshot();
  });

  test('componentDidMount', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: jest.fn()
    };
    const wrapper = shallow(
      <Dashboard.WrappedComponent {...props} />
    );
    expect(props.subscribeRoom).toHaveBeenCalled();
    expect(props.subscribeRoom.mock.calls).toEqual(subscribeRoomMock);
  });

  test('mapStateToProps', () => {
    const state = {
      dashboard,
      node
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });
});
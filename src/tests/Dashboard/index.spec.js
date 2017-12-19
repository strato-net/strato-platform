import React from 'react';
import Dashboard, { mapStateToProps } from '../../components/Dashboard/index';
import {
  dashboard,
  node,
  unSubscribeRoomMock,
  subscribeRoomMock
} from './dashboardMock';

describe('Test Dashboard index', () => {

  test('should render dashboard with empty values', () => {
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
      subscribeRoom: () => { },
      unSubscribeRoom: () => { }
    }

    const wrapper = shallow(
      <Dashboard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should render dashboard with mocked values', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: () => { },
      unSubscribeRoom: () => { }
    }

    const wrapper = shallow(
      <Dashboard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should test component functions', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: jest.fn().mockReturnValue('subscribeRoom'),
      unSubscribeRoom: jest.fn().mockReturnValue('unSubscribeRoom')
    }

    const wrapper = shallow(
      <Dashboard.WrappedComponent {...props} />
    );

    expect(wrapper.instance().props.subscribeRoom()).toBe('subscribeRoom');
    expect(wrapper.instance().props.unSubscribeRoom()).toBe('unSubscribeRoom');
  });

  test('should invoke componentWillUnmount', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: () => { },
      unSubscribeRoom: jest.fn()
    }

    const wrapper = shallow(
      <Dashboard.WrappedComponent {...props} />
    );

    wrapper.instance().componentWillUnmount();
    expect(props.unSubscribeRoom).toHaveBeenCalled();
    expect(props.unSubscribeRoom.mock.calls).toEqual(unSubscribeRoomMock);
    expect(wrapper).toMatchSnapshot();
  });

  test('should invoke subscribeRoom on componentDidMount', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: jest.fn()
    }

    const wrapper = shallow(
      <Dashboard.WrappedComponent {...props} />
    );

    expect(props.subscribeRoom).toHaveBeenCalled();
    expect(props.subscribeRoom.mock.calls).toEqual(subscribeRoomMock);
  });

  test('test mapStateToProps function', () => {
    const state = {
      dashboard,
      node
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})
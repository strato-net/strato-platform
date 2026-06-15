import React from 'react';
import NodeCard, { mapStateToProps } from "../../components/NodeCard/index";
import { dashboard, node, initialState } from '../Dashboard/dashboardMock';

describe('NodeCard: index', () => {

  describe('render component', () => {

    test('without values', () => {
      const props = {
        node: {
          "name": "LOCALHOST",
          "peers": null,
          "coinbase": null
        },
        dashboard: initialState,
        subscribeRoom: jest.fn(),
        unSubscribeRoom: jest.fn()
      };
      const wrapper = shallow(
        <NodeCard.WrappedComponent {...props} />
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
        <NodeCard.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

  });

  test('expand card on click', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: jest.fn(),
      unSubscribeRoom: jest.fn()
    };

    const wrapper = shallow(
      <NodeCard.WrappedComponent {...props} />
    );

    expect(wrapper.state('isOpen')).toBe(false);
    wrapper.find('div').at(1).simulate('click');
    expect(wrapper.state('isOpen')).toBe(true);
    wrapper.find('div').at(1).simulate('click');
    expect(wrapper.state('isOpen')).toBe(false);
  });

  test('valid functions as a props', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: jest.fn().mockReturnValue('subscribeRoom'),
      unSubscribeRoom: jest.fn().mockReturnValue('unSubscribeRoom')
    };

    const wrapper = shallow(
      <NodeCard.WrappedComponent {...props} />
    );

    expect(wrapper.instance().props.subscribeRoom()).toBe('subscribeRoom');
    expect(wrapper.instance().props.unSubscribeRoom()).toBe('unSubscribeRoom');
  });

  test('componentDidMount', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: jest.fn(),
      unSubscribeRoom: jest.fn()
    };

    const wrapper = shallow(
      <NodeCard.WrappedComponent {...props} />
    );

    expect(props.subscribeRoom).toHaveBeenCalled();
    expect(props.subscribeRoom.mock.calls).toEqual([["GET_PEERS"]]);
  });

  test('componentWillUnmount', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: jest.fn(),
      unSubscribeRoom: jest.fn(),
    };

    const wrapper = shallow(
      <NodeCard.WrappedComponent {...props} />
    );

    wrapper.unmount();
    expect(props.unSubscribeRoom).toHaveBeenCalled();
    expect(props.unSubscribeRoom.mock.calls).toEqual([["GET_PEERS"]]);
  });

  test('mapStateToProps', () => {
    const state = {
      dashboard,
      node
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});
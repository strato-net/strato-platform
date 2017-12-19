import React from 'react';
import NodeCard, { mapStateToProps } from "../../components/NodeCard/index";
import { dashboard, node, initialState } from '../Dashboard/dashboardMock';

describe('Test NodeCard index', () => {

  it('should render with empty values', () => {
    const props = {
      node: {
        "name": "LOCALHOST",
        "peers": null,
        "coinbase": null
      },
      dashboard: initialState,
      subscribeRoom: () => { },
      unSubscribeRoom: () => { }
    };
    const wrapper = shallow(
      <NodeCard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  it('should render with mocked values', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: () => { },
      unSubscribeRoom: () => { }
    };

    const wrapper = shallow(
      <NodeCard.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  })

  it('should change state on handleClick', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: () => { },
      unSubscribeRoom: () => { }
    };

    const wrapper = shallow(
      <NodeCard.WrappedComponent {...props} />
    );

    expect(wrapper.state('isOpen')).toBe(false);
    wrapper.find('div').at(1).simulate('click');
    expect(wrapper.state('isOpen')).toBe(true);
    wrapper.find('div').at(1).simulate('click');
    expect(wrapper.state('isOpen')).toBe(false);
  })

  it('should invoke subscribeRoom on componentDidMount', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: jest.fn(),
      unSubscribeRoom: () => { }
    };

    const wrapper = shallow(
      <NodeCard.WrappedComponent {...props} />
    );

    expect(props.subscribeRoom).toHaveBeenCalled();
    expect(props.subscribeRoom.mock.calls).toEqual([["GET_COINBASE"], ["GET_PEERS"]]);
  })

  it('should invoke componentWillUnmount', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: () => { },
      unSubscribeRoom: jest.fn(),
    };

    const wrapper = shallow(
      <NodeCard.WrappedComponent {...props} />
    );

    wrapper.instance().componentWillUnmount();
    expect(props.unSubscribeRoom).toHaveBeenCalled();
    expect(props.unSubscribeRoom.mock.calls).toEqual([["GET_COINBASE"], ["GET_PEERS"]]);
  })

  it('test mapStateToProps function', () => {
    const state = {
      dashboard,
      node
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  })

})
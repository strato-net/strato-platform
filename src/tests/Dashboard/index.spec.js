import React from 'react';
import Dashboard, { mapStateToProps } from '../../components/Dashboard/index';
import { dashboard, node } from './dashboardMock';

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

  test('should invoke componentWillUnmount', () => {
    const props = {
      dashboard,
      node,
      subscribeRoom: () => { },
      unSubscribeRoom: () => { }
    }

    const wrapper = shallow(
      <Dashboard.WrappedComponent {...props} />
    );

    wrapper.instance().componentWillUnmount();
    expect(wrapper).toMatchSnapshot();
  });

  test('test mapStateToProps function', () => {
    const state = {
      dashboard,
      node
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})
import React from 'react';
import App, { mapStateToProps } from '../../App';
import * as checkMode from '../../lib/checkMode';

describe('App: index', () => {

  test('render component', () => {
    const wrapper = shallow(
      <App.WrappedComponent 
        getOrCreateOauthUserRequest={jest.fn()}
        fetchHealth={jest.fn()}
        fetchMetadata={jest.fn()}
        />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  });

  test('componentDidMount', () => {
    checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);

    const wrapper = shallow(
      <App.WrappedComponent 
        fetchHealth={jest.fn()}
        fetchMetadata={jest.fn()}
      />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  })

  test('componentDidMount', () => {
    checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);

    const wrapper = shallow(
      <App.WrappedComponent getOrCreateOauthUserRequest={jest.fn()} 
      fetchHealth={jest.fn()}
      fetchMetadata={jest.fn()}
      />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  })

  describe('mapStateToProps', () => {
    const state = { 
      user: {
        oauthUser: undefined, 
        userCertificate: undefined
      },
      appMetadata: {
        error: undefined,
        loading: undefined,
        health: undefined,
        metadata: undefined,
        nodeInfo: undefined,
      } 
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  })

});
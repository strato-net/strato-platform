import React from 'react';
import App, { mapStateToProps } from '../../App';
import * as checkMode from '../../lib/checkMode';

describe('App: index', () => {

  test('render component', () => {
    const wrapper = shallow(
      <App.WrappedComponent getOrCreateOauthUserRequest={jest.fn()}/>
    );

    expect(wrapper.debug()).toMatchSnapshot();
  });

  test('componentDidMount1', () => {
    checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);

    const wrapper = shallow(
      <App.WrappedComponent />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  })

  test('componentDidMount2', () => {
    checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);

    const wrapper = shallow(
      <App.WrappedComponent getOrCreateOauthUserRequest={jest.fn()} />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  })

  describe('mapStateToProps', () => {
    const state = { user: {oauthUser: undefined, userCertificate: undefined} }
    expect(mapStateToProps(state)).toMatchSnapshot();
  })

});
import React from 'react';
import App, { mapStateToProps } from '../../App';
import * as checkMode from '../../lib/checkMode';

describe('App: index', () => {

  test('render component', () => {
    const wrapper = shallow(
      <App.WrappedComponent />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  });

  test('componentDidMount', () => {
    checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
    checkMode.getUserFromLocal = jest.fn().mockReturnValue(false);

    const wrapper = shallow(
      <App.WrappedComponent />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  })

  test('componentDidMount', () => {
    checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
    checkMode.getUserFromLocal = jest.fn().mockReturnValue(false);

    const wrapper = shallow(
      <App.WrappedComponent getOrCreateOauthUserRequest={jest.fn()} />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  })

  describe('mapStateToProps', () => {
    const state = {}
    expect(mapStateToProps(state)).toMatchSnapshot();
  })

});
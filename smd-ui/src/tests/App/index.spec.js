import React from 'react';
import App, { mapStateToProps } from '../../App';
import * as checkMode from '../../lib/checkMode';
import * as scenes from '../../routes';
import * as localStorage from '../../lib/localStorage';

describe('App: index', () => {

  describe('render in public mode', () => {
    beforeAll(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(true);
      scenes.routes = "PUBLIC";
    });

    test('when user is not logged in', () => {
      const wrapper = shallow(
        <App.WrappedComponent />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('when user is logged in', () => {
      const wrapper = shallow(
        <App.WrappedComponent isLoggedIn />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });
  })

  test('render in enterprise mode', () => {
    checkMode.isModePublic = jest.fn().mockReturnValue(false);
    scenes.routes = "ENTERPRISE";
    const wrapper = shallow(
      <App.WrappedComponent />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  })

  describe('render in Oauth mode', () => {

    test('componentDidMount', () => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
      checkMode.getUserFromLocal = jest.fn().mockReturnValue(false);
      scenes.routes = "ENTERPRISE";
      const wrapper = shallow(
        <App.WrappedComponent />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    })

    test('componentDidMount', () => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
      checkMode.getUserFromLocal = jest.fn().mockReturnValue(false);
      scenes.routes = "ENTERPRISE";
      const wrapper = shallow(
        <App.WrappedComponent getOrCreateOauthUserRequest={jest.fn()}/>
      );

      expect(wrapper.debug()).toMatchSnapshot();
    })
    
  });

  describe('mapStateToProps', () => {
    test('without values', () => {
      const state = {
        user: {
          isLoggedIn: false,
        }
      }
      expect(mapStateToProps(state)).toMatchSnapshot();
    });

    test('with values', () => {
      const state = {
        user: {
          isLoggedIn: true,
        }
      }
      expect(mapStateToProps(state)).toMatchSnapshot();
    });
  })

});
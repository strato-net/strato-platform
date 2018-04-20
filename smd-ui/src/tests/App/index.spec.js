import React from 'react';
import App, { mapStateToProps } from '../../App';
import * as checkMode from '../../lib/checkMode';

describe('App: index', () => {

  describe('render in public mode', () => {
    checkMode.isModePublic = jest.fn().mockReturnValue(true);

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
    const wrapper = shallow(
      <App.WrappedComponent />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  })

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
import React from 'react';
import Login, { mapStateToProps } from '../../components/Login';

describe('Login: index', () => {

  describe('renders', () => {

    test('with values', () => {
      const props = {
        isOpen: true,
        resetSelectedApp: jest.fn(),
        closeLoginOverlay: jest.fn(),
        resetError: jest.fn()
      };

      const wrapper = shallow(
        <Login.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

    test('without values', () => {
      const props = {
        isOpen: false,
        resetSelectedApp: jest.fn(),
        closeLoginOverlay: jest.fn(),
        resetError: jest.fn()
      };

      const wrapper = shallow(
        <Login.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

  });

  describe('componentWillReceiveProps', () => {

    test('when all condtion is true', () => {
      const props = {
        isOpen: false,
        resetSelectedApp: jest.fn(),
        closeLoginOverlay: jest.fn(),
        resetError: jest.fn()
      };

      const newProps = {
        isLoggedIn: true,
        selectedApp: { address: '', url: 'loca' },
        serverError: 'Login Failed',
        launchApp: jest.fn(),
        resetSelectedApp: jest.fn(),
        resetError: jest.fn()
      }

      const wrapper = shallow(
        <Login.WrappedComponent {...props} />
      );

      wrapper.instance().componentWillReceiveProps(newProps);
      expect(newProps.launchApp).toHaveBeenCalled();
      expect(newProps.launchApp).toHaveBeenCalledTimes(1);
      expect(newProps.resetSelectedApp).toHaveBeenCalled();
      expect(newProps.resetSelectedApp).toHaveBeenCalledTimes(1);
      expect(props.resetError).toHaveBeenCalled();
      expect(props.resetError).toHaveBeenCalledTimes(1);
    });

    test('when all condtion is false', () => {
      const props = {
        isOpen: false,
        resetSelectedApp: jest.fn(),
        closeLoginOverlay: jest.fn(),
        resetError: jest.fn()
      };

      const newProps = {
        isLoggedIn: false,
        selectedApp: null,
        serverError: null,
        launchApp: jest.fn(),
        resetSelectedApp: jest.fn(),
        resetError: jest.fn()
      }

      const wrapper = shallow(
        <Login.WrappedComponent {...props} />
      );

      wrapper.instance().componentWillReceiveProps(newProps);
      expect(newProps.launchApp).not.toHaveBeenCalled();
      expect(newProps.launchApp).not.toHaveBeenCalledTimes(1);
      expect(newProps.resetSelectedApp).not.toHaveBeenCalled();
      expect(newProps.resetSelectedApp).not.toHaveBeenCalledTimes(1);
      expect(props.resetError).not.toHaveBeenCalled();
      expect(props.resetError).not.toHaveBeenCalledTimes(1);
    });

  });

  test('close modal', () => {
    const props = {
      isOpen: false,
      resetSelectedApp: jest.fn(),
      closeLoginOverlay: jest.fn(),
      resetError: jest.fn()
    };

    const wrapper = shallow(
      <Login.WrappedComponent {...props} />
    );

    let dailog = wrapper.find('Dialog').dive();
    dailog.get(0).props.onClose();
    expect(props.resetSelectedApp).toHaveBeenCalled();
    expect(props.resetSelectedApp).toHaveBeenCalledTimes(1);
    expect(props.closeLoginOverlay).toHaveBeenCalled();
    expect(props.closeLoginOverlay).toHaveBeenCalledTimes(1);
  });

  test('mapStateToProps', () => {
    const state = {
      user: {
        isLoggedIn: true,
        isOpen: true,
        serverError: 'Incorrect login details'
      },
      applications: {
        selectedApp: {},
      }
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});
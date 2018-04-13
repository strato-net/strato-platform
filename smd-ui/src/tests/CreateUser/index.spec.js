import React from 'react';
import CreateUser, { mapStateToProps, validate } from '../../components/CreateUser';
import { Provider } from 'react-redux';
import configureStore from 'redux-mock-store';
import { Dialog } from '@blueprintjs/core';
import { reducer as formReducer } from 'redux-form'
import { createStore, combineReducers } from 'redux'
import ReactDOM from 'react-dom';

describe('Test createUser index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
  });

  test('render component', () => {
    const props = {
      spinning: false,
      closeWalkThroughOverlay: jest.fn(),
      openLoginOverlay: jest.fn(),
      firstTimeLogin: jest.fn(),
      resetError: jest.fn(),
      store: store
    }
    const wrapper = shallow(
      <CreateUser.WrappedComponent {...props} />
    ).dive().dive().dive();

    expect(wrapper).toMatchSnapshot();
  });

  test('component methods', () => {
    const props = {
      serverError: false,
      spinning: false,
      openLoginOverlay: jest.fn().mockReturnValue('Open'),
      closeWalkThroughOverlay: jest.fn().mockReturnValue('Close'),
      firstTimeLogin: jest.fn().mockReturnValue('Success'),
      resetError: jest.fn().mockReturnValue('Reset'),
    }
    const wrapper = shallow(
      <Provider store={store}>
        <CreateUser.WrappedComponent {...props} />
      </Provider>
    ).dive();

    expect(wrapper.instance().props.openLoginOverlay()).toBe('Open');
    expect(wrapper.instance().props.closeWalkThroughOverlay()).toBe('Close');
    expect(wrapper.instance().props.firstTimeLogin()).toBe('Success');
    expect(wrapper.instance().props.resetError()).toBe('Reset');
  });

  test(`Open 'already have an account' modal`, () => {
    const props = {
      spinning: false,
      closeWalkThroughOverlay: jest.fn(),
      openLoginOverlay: jest.fn(),
      firstTimeLogin: jest.fn(),
      resetError: jest.fn(),
      store: store
    }
    const wrapper = shallow(
      <CreateUser.WrappedComponent {...props} />
    ).dive().dive().dive();

    wrapper.find('Button').at(0).simulate('click');
    expect(props.closeWalkThroughOverlay).toHaveBeenCalled();
    expect(props.closeWalkThroughOverlay).toHaveBeenCalledTimes(1);
    expect(props.openLoginOverlay).toHaveBeenCalled();
    expect(props.openLoginOverlay).toHaveBeenCalledTimes(1);
  });

  describe('Component:', () => {

    test('errorMessageFor method', () => {
      const props = {
        spinning: false,
        closeWalkThroughOverlay: jest.fn(),
        openLoginOverlay: jest.fn(),
        firstTimeLogin: jest.fn(),
        resetError: jest.fn(),
        store: store
      }
      const wrapper = shallow(
        <CreateUser.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.setState({ errors: { password: 'must have password' } });
      expect(wrapper.instance().errorMessageFor("password")).toMatchSnapshot();
      expect(wrapper.instance().errorMessageFor(null)).toMatchSnapshot();
    });

  });

  describe('Form', () => {
    
    test('simulate fields', () => {
      const props = {
        serverError: false,
        spinning: false,
        openLoginOverlay: jest.fn().mockReturnValue('Open'),
        closeWalkThroughOverlay: jest.fn().mockReturnValue('Close'),
        firstTimeLogin: jest.fn().mockReturnValue('Success'),
        resetError: jest.fn().mockReturnValue('Reset'),
        handleSubmit: jest.fn()
      }
      const wrapper = mount(
        <Provider store={store}>
          <CreateUser.WrappedComponent {...props} />
        </Provider>
      );

      wrapper.find('Field').at(0).simulate('change', { target: { value: 'no-reply@blockapps.com' } });
      wrapper.find('Button').at(1).simulate('click');
      expect(props.handleSubmit).toHaveBeenCalled();
      expect(store.getState().form['create-user']).toMatchSnapshot();

    });

    test('simulate submit with valid validation', () => {
      const props = {
        spinning: false,
        closeWalkThroughOverlay: jest.fn(),
        openLoginOverlay: jest.fn(),
        firstTimeLogin: jest.fn(),
        resetError: jest.fn(),
        firstTimeLogin: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <CreateUser.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().submit({ email: 'no-reply@blockapps.com' });
      expect(props.firstTimeLogin).toHaveBeenCalled();
      expect(props.firstTimeLogin).toHaveBeenCalledTimes(1);
    });

    test('simulate submit with invalid validation', () => {
      const props = {
        spinning: false,
        closeWalkThroughOverlay: jest.fn(),
        openLoginOverlay: jest.fn(),
        firstTimeLogin: jest.fn(),
        resetError: jest.fn(),
        store: store
      }

      const wrapper = shallow(
        <CreateUser.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().submit({ email: null });
      expect(props.firstTimeLogin).not.toHaveBeenCalled();
      expect(props.firstTimeLogin).not.toHaveBeenCalledTimes(1);
    });

  });

  test('componentWillReceiveProps', () => {
    const props = {
      spinning: false,
      closeWalkThroughOverlay: jest.fn(),
      openLoginOverlay: jest.fn(),
      firstTimeLogin: jest.fn(),
      resetError: jest.fn(),
      store: store
    }

    const newProps = {
      serverError: 'not an valid email'
    }

    const wrapper = shallow(
      <CreateUser.WrappedComponent {...props} />
    ).dive().dive().dive();


    wrapper.instance().componentWillReceiveProps(newProps);
    expect(props.resetError).toHaveBeenCalled();
    expect(props.resetError).toHaveBeenCalledTimes(1);
  });

  test('mapStateToProps with default state', () => {
    const state = {
      user: {
        spinning: false
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});
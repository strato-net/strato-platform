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

  test('mapStateToProps with default state', () => {
    const state = {
      user: {
        spinning: false
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

  describe('validate', () => {

    test('with values', () => {
      const values = {
        email: "tanuj@blockapps.net"
      }
      expect(validate(values)).toMatchSnapshot();
    });

    test('with empty values', () => {
      const values = {
        email: null
      }
      expect(validate(values)).toMatchSnapshot();
    });

    test('when email has invalid format', () => {
      const values = {
        email: "tanuj"
      }
      expect(validate(values)).toMatchSnapshot();
    });

  });

});
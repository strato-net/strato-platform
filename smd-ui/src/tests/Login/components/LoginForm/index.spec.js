import React from 'react';
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';
import { Provider } from 'react-redux';

import LoginForm, { mapStateToProps } from '../../../../components/Login/components/LoginForm';

describe('LoginForm: index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
  });

  test('renders', () => {
    const props = {
      spinning: false,
      login: jest.fn(),
      closeLoginOverlay: jest.fn(),
      openWalkThroughOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <LoginForm.WrappedComponent {...props} />
    ).dive().dive().dive();

    expect(wrapper).toMatchSnapshot();
  });

  describe('Form:', () => {
    test('simulate fields', () => {
      const props = {
        spinning: false,
        login: jest.fn(),
        closeLoginOverlay: jest.fn(),
        openWalkThroughOverlay: jest.fn(),
        handleSubmit: jest.fn()
      };

      const wrapper = mount(
        <Provider store={store}>
          <LoginForm.WrappedComponent {...props} />
        </Provider>
      );

      wrapper.find('Field').at(0).simulate('change', { target: { value: 'no-reply@blockapps.com' } });
      wrapper.find('Field').at(1).simulate('change', { target: { value: 'password' } });
      wrapper.find('Button').at(1).simulate('click');
      expect(props.handleSubmit).toHaveBeenCalled();
      expect(store.getState().form['user-login']).toMatchSnapshot();

    });

    test('simulate submit with valid validation', () => {
      const props = {
        spinning: false,
        login: jest.fn(),
        closeLoginOverlay: jest.fn(),
        openWalkThroughOverlay: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <LoginForm.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().submit({ username: 'no-reply@blockapps.com', password: 'password' });
      expect(props.login).toHaveBeenCalled();
      expect(props.login).toHaveBeenCalledTimes(1);
    });

    test('simulate submit with invalid validation', () => {
      const props = {
        spinning: false,
        login: jest.fn(),
        closeLoginOverlay: jest.fn(),
        openWalkThroughOverlay: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <LoginForm.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().submit({});
      expect(props.login).not.toHaveBeenCalled();
      expect(props.login).not.toHaveBeenCalledTimes(1);
    });

  });

  test('open create user modal', () => {
    const props = {
      spinning: false,
      login: jest.fn(),
      closeLoginOverlay: jest.fn(),
      openWalkThroughOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <LoginForm.WrappedComponent {...props} />
    ).dive().dive().dive();

    wrapper.find('Button').at(0).simulate('click');
    expect(props.closeLoginOverlay).toHaveBeenCalled();
    expect(props.closeLoginOverlay).toHaveBeenCalledTimes(1);
    expect(props.openWalkThroughOverlay).toHaveBeenCalled();
    expect(props.openWalkThroughOverlay).toHaveBeenCalledTimes(1);

  });

  test('errorMessageFor method', () => {
    const props = {
      spinning: false,
      login: jest.fn(),
      closeLoginOverlay: jest.fn(),
      openWalkThroughOverlay: jest.fn(),
      handleSubmit: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <LoginForm.WrappedComponent {...props} />
    ).dive().dive().dive();

    wrapper.setState({ errors: { username: 'must have username' } });
    expect(wrapper.instance().errorMessageFor('username')).toMatchSnapshot();
    expect(wrapper.instance().errorMessageFor(null)).toMatchSnapshot();

  });

  test('mapStateToProps', () => {
    const state = {
      user: { spinning: true }
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});
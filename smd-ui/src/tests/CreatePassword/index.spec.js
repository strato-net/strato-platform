import React from 'react';
import CreatePassword, { mapStateToProps } from '../../components/CreatePassword';
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';
import { Provider } from 'react-redux';


describe('CreatePassword: index', () => {

  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  });

  test('empty values', () => {
    const props = {
      createUser: jest.fn(),
      handleSubmit: jest.fn(),
      store: store
    }
    const wrapper = shallow(
      <CreatePassword.WrappedComponent {...props} />
    ).dive().dive().dive();
    expect(wrapper).toMatchSnapshot();
  });

  describe('componentWillReceiveProps: ', () => {

    test('invoke with truthy statement', () => {
      const props = {
        createUser: jest.fn(),
        handleSubmit: jest.fn(),
        resetError: jest.fn(),
        store: store
      };

      const newProps = {
        serverError: 'Server error occured'
      };

      const wrapper = shallow(
        <CreatePassword.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().componentWillReceiveProps(newProps);
      expect(props.resetError).toHaveBeenCalled();
      expect(props.resetError).toHaveBeenCalledTimes(1);
    });

    test('invoke with falsy statement', () => {
      const props = {
        createUser: jest.fn(),
        handleSubmit: jest.fn(),
        resetError: jest.fn(),
        store: store
      };

      const newProps = {
        serverError: null
      };

      const wrapper = shallow(
        <CreatePassword.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().componentWillReceiveProps(newProps);
      expect(props.resetError).not.toHaveBeenCalled();
      expect(props.resetError).not.toHaveBeenCalledTimes(1);
    });

  });

  describe('Form:', () => {

    test('simulate fields', () => {
      const props = {
        email: 'blockapps@yahoo.com',
        createUser: jest.fn(),
        handleSubmit: jest.fn(),
        resetError: jest.fn(),
        store: store
      };

      const wrapper = mount(
        <Provider store={store}>
          <CreatePassword.WrappedComponent {...props} />
        </Provider>
      );

      wrapper.find('Field').at(0).simulate('change', { target: { value: 'password' } });
      wrapper.find('Field').at(1).simulate('change', { target: { value: 'password' } });

      wrapper.find('Button').at(0).simulate('click');
      expect(props.handleSubmit).toHaveBeenCalled();
      expect(store.getState().form['createPassword']).toMatchSnapshot();
    });

    test('simulate submit with valid validation', () => {
      const props = {
        createUser: jest.fn(),
        handleSubmit: jest.fn(),
        resetError: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <CreatePassword.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().submit({ password: 'password', confirmPassword: 'password' });
      expect(props.createUser).toHaveBeenCalled();
      expect(props.createUser).toHaveBeenCalledTimes(1);
    });

    test('simulate submit with invalid validation', () => {
      const props = {
        createUser: jest.fn(),
        handleSubmit: jest.fn(),
        resetError: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <CreatePassword.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.instance().submit({ password: 'password', confirmPassword: 'passwo' });
      expect(props.createUser).not.toHaveBeenCalled();
      expect(props.createUser).not.toHaveBeenCalledTimes(1);
    });

  });

  describe('Component:', () => {

    test('errorMessageFor method', () => {
      const props = {
        createUser: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      }
      const wrapper = shallow(
        <CreatePassword.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.setState({ errors: { password: 'must have password' } });
      expect(wrapper.instance().errorMessageFor("password")).toMatchSnapshot();
      expect(wrapper.instance().errorMessageFor(null)).toMatchSnapshot();
    });

  });

  test('mapStateToProps with default state', () => {
    const state = {
      createUser: {
        error: 'error'
      },
      user: {
        firstTimeUser: true
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});
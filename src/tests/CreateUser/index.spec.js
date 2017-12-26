import React from 'react';
import CreateUser, { mapStateToProps, validate } from '../../components/CreateUser';
import { Provider } from 'react-redux';
import configureStore from 'redux-mock-store';
import { Dialog } from '@blueprintjs/core';


const mockStore = configureStore([]);

describe('Test createUser index', () => {

  test('should render contracts without values', () => {
    const props = {
      filter: '',
      contracts: {},
      errors: {},
      openOverlay: jest.fn(),
      closeOverlay: jest.fn(),
      createUser: jest.fn()
    }

    const store = mockStore({});
    const wrapper = render(
      <Provider store={store}>
        <CreateUser.WrappedComponent {...props} />
      </Provider>
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should open model on button click', () => {
    const props = {
      filter: '',
      contracts: {},
      errors: {},
      openOverlay: jest.fn(),
      closeOverlay: jest.fn(),
      createUser: jest.fn()
    }

    const store = mockStore({});
    const wrapper = mount(
      <Provider store={store}>
        <CreateUser.WrappedComponent {...props} />
      </Provider>
    );

    wrapper.find('Button').simulate('click');
    expect(props.openOverlay).toHaveBeenCalled();
  });

  test('should onClose work correctly on outside click', () => {
    const props = {
      filter: '',
      contracts: {},
      errors: {},
      isOpen: true,
      openOverlay: jest.fn(),
      closeOverlay: jest.fn(),
      createUser: jest.fn()
    }

    const store = mockStore({});
    const wrapper = mount(
      <Provider store={store}>
        <CreateUser.WrappedComponent {...props} />
      </Provider>
    );

    wrapper.find(Dialog).get(0).props.onClose();
    expect(props.closeOverlay).toHaveBeenCalled();
  });

  test('should test component functions', () => {
    const props = {
      filter: '',
      contracts: {},
      errors: {
        confirm_password: "Must Confirm Password",
        password: "Password Required",
        username: "Username Required"
      },
      openOverlay: jest.fn().mockReturnValue('Open'),
      closeOverlay: jest.fn().mockReturnValue('Close'),
      createUser: jest.fn().mockReturnValue('Create')
    }

    const store = mockStore({});
    const wrapper = shallow(
      <Provider store={store}>
        <CreateUser.WrappedComponent {...props} />
      </Provider>
    ).dive();

    expect(wrapper.instance().props.openOverlay()).toBe('Open');
    expect(wrapper.instance().props.closeOverlay()).toBe('Close');
    expect(wrapper.instance().props.createUser()).toBe('Create');
  });

  test('should test mapStateToProps function', () => {
    const state = {
      "form": {
        "create-user": {
          "syncErrors": {
            confirm_password: "Must Confirm Password",
            password: "Password Required",
            username: "Username Required"
          }
        }
      },
      "createUser": {
        isOpen: true
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

  test('should test validate function with values', () => {
    const values = {
      confirm_password: "pass",
      password: "pass",
      username: "tanuj"
    }

    expect(validate(values)).toMatchSnapshot();
  });

  test('should test validate function with empty values', () => {
    const values = {
      confirm_password: null,
      password: null,
      username: null
    }

    expect(validate(values)).toMatchSnapshot();
  });

  test('should test validate when passowrd does not match', () => {
    const values = {
      confirm_password: "pass",
      password: "pas",
      username: "tanuj"
    }

    expect(validate(values)).toMatchSnapshot();
  });

});
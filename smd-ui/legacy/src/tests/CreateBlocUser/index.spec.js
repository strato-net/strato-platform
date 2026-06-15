import React from 'react';
import CreateBlocUser, { mapStateToProps, validate } from '../../components/CreateBlocUser';
import { Provider } from 'react-redux';
import configureStore from 'redux-mock-store';
import { Dialog } from '@blueprintjs/core';
import { reducer as formReducer } from 'redux-form'
import { createStore, combineReducers } from 'redux'
import ReactDOM from 'react-dom';

describe('createBlocUser: index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
  });

  describe('render component', () => {

    test('without values', () => {
      const props = {
        filter: '',
        contracts: {},
        errors: {},
        openOverlay: jest.fn(),
        closeOverlay: jest.fn(),
        createBlocUser: jest.fn(),
        store: store
      }
      const wrapper = shallow(
        <CreateBlocUser.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        filter: '',
        contracts: {},
        errors: {
          confirm_password: "Must Confirm Password",
          password: "Password Required",
          username: "Username Required"
        },
        openOverlay: jest.fn(),
        closeOverlay: jest.fn(),
        createBlocUser: jest.fn(),
        store: store
      }
      const wrapper = shallow(
        <CreateBlocUser.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('simulate', () => {

    test('open modal', () => {
      const props = {
        filter: '',
        contracts: {},
        openOverlay: jest.fn(),
        closeOverlay: jest.fn(),
        createBlocUser: jest.fn()
      }
      const wrapper = mount(
        <Provider store={store}>
          <CreateBlocUser.WrappedComponent {...props} />
        </Provider>
      );
      wrapper.find('Button').simulate('click');
      expect(props.openOverlay).toHaveBeenCalled();
    });

    test('close modal on outside click', () => {
      const props = {
        filter: '',
        contracts: {},
        isOpen: true,
        openOverlay: jest.fn(),
        closeOverlay: jest.fn(),
        createBlocUser: jest.fn()
      }
      const wrapper = mount(
        <Provider store={store}>
          <CreateBlocUser.WrappedComponent {...props} />
        </Provider>
      );
      wrapper.find(Dialog).get(0).props.onClose();
      expect(props.closeOverlay).toHaveBeenCalled();
    });

    test('close modal on button click', () => {
      const props = {
        filter: '',
        contracts: {},
        isOpen: true,
        openOverlay: jest.fn(),
        closeOverlay: jest.fn(),
        createBlocUser: jest.fn(),
        store: store
      }
      const wrapper = shallow(
        <CreateBlocUser.WrappedComponent {...props} />
      ).dive().dive().dive();
      wrapper.find('Button').at(1).simulate('click')
      expect(props.closeOverlay).toHaveBeenCalled();
    });

    test('submit form', () => {
      const props = {
        filter: '',
        contracts: {},
        isOpen: true,
        openOverlay: jest.fn(),
        closeOverlay: jest.fn(),
        createBlocUser: jest.fn(),
        store: store
      }
      const wrapper = shallow(
        <CreateBlocUser.WrappedComponent {...props} />
      ).dive().dive().dive();
      wrapper.find('Button').at(2).simulate('click')
      expect(props.createBlocUser).toHaveBeenCalled()
    });

  })

  test('component methods', () => {
    const props = {
      filter: '',
      contracts: {},
      openOverlay: jest.fn().mockReturnValue('Open'),
      closeOverlay: jest.fn().mockReturnValue('Close'),
      createBlocUser: jest.fn().mockReturnValue('Create')
    }
    const wrapper = shallow(
      <Provider store={store}>
        <CreateBlocUser.WrappedComponent {...props} />
      </Provider>
    ).dive();

    expect(wrapper.instance().props.openOverlay()).toBe('Open');
    expect(wrapper.instance().props.closeOverlay()).toBe('Close');
    expect(wrapper.instance().props.createBlocUser()).toBe('Create');
  });

  describe('mapStateToProps', () => {

    test('with errors', () => {
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
        "createBlocUser": {
          isOpen: true
        }
      }
      expect(mapStateToProps(state)).toMatchSnapshot();
    });

    test('without errors', () => {
      const state = {
        "form": {},
        "createBlocUser": {
          isOpen: true
        }
      }
      expect(mapStateToProps(state)).toMatchSnapshot();
    });

  });

  describe('validate', () => {

    test('with values', () => {
      const values = {
        confirm_password: "pass",
        password: "pass",
        username: "tanuj"
      }
      expect(validate(values)).toMatchSnapshot();
    });

    test('with empty values', () => {
      const values = {
        confirm_password: null,
        password: null,
        username: null
      }
      expect(validate(values)).toMatchSnapshot();
    });

    test('when password does not match', () => {
      const values = {
        confirm_password: "pass",
        password: "pas",
        username: "tanuj"
      }
      expect(validate(values)).toMatchSnapshot();
    });

  });

});
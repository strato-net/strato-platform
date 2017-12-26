import LaunchPad, { mapStateToProps } from '../../components/LaunchPad/index'
import React from 'react'
import { mount } from 'enzyme'
import { reducer as formReducer } from 'redux-form'
import { createStore, combineReducers } from 'redux'
import { Provider } from 'react-redux'
import { Router, Switch, Redirect, Link, MemoryRouter } from 'react-router-dom';

describe("Test Launchpad", () => {

  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  })

  test('should test component will mount', () => {
    const props = {
      history: { push: '/apps' },
      accounts: {},
      launchPad: {
        firstLoad: true,
        username: '',
        error: '',
        appPackage: null,
        requestCompleted: false
      },
      usernameChange: jest.fn(),
      loadLaunchPad: jest.fn(),
      fetchAccounts: jest.fn(),
      appUploadRequest: jest.fn(),
      appSetError: jest.fn(),
      appReset: jest.fn()
    }

    let wrapper = mount(
      <Provider store={store}>
        <MemoryRouter >
          <LaunchPad.WrappedComponent {...props} />
        </MemoryRouter>
      </Provider>)
    expect(props.loadLaunchPad).toHaveBeenCalled();
  });

  test('should test mapStateToProps function', () => {
    const state = {
      accounts: {},
      launchPad: {
        firstLoad: true,
        username: '',
        error: '',
        appPackage: null,
        requestCompleted: false
      },
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})
import LaunchPad, { mapStateToProps } from '../../components/LaunchPad/index'
import React from 'react'
import { mount } from 'enzyme'
import { reducer as formReducer } from 'redux-form'
import { createStore, combineReducers } from 'redux'
import { Provider } from 'react-redux'
import { Router, Switch, Redirect, Link, MemoryRouter } from 'react-router-dom'
import { accountsMock, indexAccountsMock } from '../Accounts/accountsMock'
import { uploadData } from './launchpadMock'

describe("Launchpad: index", () => {

  let store
  let files

  beforeAll(() => {
    files = [
      {
        lastModified: 1510147428520,
        name: "app.zip",
        preview: "blob:http://cd10.eastus.cloudapp.azure.com/16387655-5a30-4857-819e-275552978b45",
        size: 1725827,
        type: "application/zip",
        webkitRelativePath: ""
      }
    ]
  });

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  })

  test('render component with initial', () => {
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
      appReset: jest.fn(),
      store: store
    }
    const wrapper = shallow(
      <LaunchPad.WrappedComponent {...props} />
    ).dive().dive().dive();
    expect(wrapper).toMatchSnapshot();
  });

  test('mapStateToProps with default state', () => {
    const state = {
      accounts: accountsMock,
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

  test('component will mount', () => {
    const props = {
      accounts: {},
      launchPad: {
        appPackage: null,
        error: "",
        firstLoad: true,
        requestCompleted: false,
        username: ""
      },
      usernameChange: jest.fn(),
      loadLaunchPad: jest.fn(),
      fetchAccounts: jest.fn(),
      appUploadRequest: jest.fn(),
      appSetError: jest.fn(),
      appReset: jest.fn(),
      store: store
    }
    const wrapper = shallow(
      <LaunchPad.WrappedComponent {...props} />
    ).dive().dive().dive();
    expect(props.fetchAccounts).toHaveBeenCalled()
    expect(props.loadLaunchPad).toHaveBeenCalled()
  });

  test('simulate events', () => {
    const props = {
      accounts: indexAccountsMock,
      launchPad: {
        appPackage: null,
        error: "",
        firstLoad: true,
        requestCompleted: false,
        username: "Buyer1"
      },
      usernameChange: jest.fn(),
      loadLaunchPad: jest.fn(),
      fetchAccounts: jest.fn(),
      appUploadRequest: jest.fn(),
      appSetError: jest.fn(),
      appReset: jest.fn(),
    }
    let wrapper = mount(
      <Provider store={store}>
        <MemoryRouter >
          <LaunchPad.WrappedComponent {...props} />
        </MemoryRouter>
      </Provider>)

    expect(wrapper.find('button').at(2).props().disabled).toBeTruthy()

    const fields = wrapper.find('Field')
    fields.at(0).simulate('change', { target: { value: 'Supplier2' } })
    expect(props.usernameChange).toHaveBeenCalled()

    const userAddress = fields.at(1)
    expect(userAddress.instance().value).toBe(undefined)
    userAddress.simulate('change', { target: { value: '044eda43ba9c76fc36b9183c96f7a8fad8d21fe6' } })
    expect(userAddress.instance().value).toBe('044eda43ba9c76fc36b9183c96f7a8fad8d21fe6')

    const password = fields.at(2)
    expect(password.instance().value).toBe(undefined)
    password.simulate('change', { target: { value: 'security' } })
    expect(password.instance().value).toBe('security')

    const dropZone = fields.at(3).find('Dropzone')
    const testFile = [{
      lastModified: 1510147428520,
      name: "abc.zip",
      size: 1725827,
      type: "application/zip",
      webkitRelativePath: ""
    }]
    dropZone.simulate('drop', { dataTransfer: { files: testFile } })
    expect(wrapper.find('button').at(2).props().disabled).toBeFalsy()
    wrapper.find('button').at(2).simulate('click')
    expect(props.appUploadRequest).toHaveBeenCalledWith(uploadData)

  });

  test('multiple file upload', () => {
    const props = {
      accounts: indexAccountsMock,
      launchPad: {
        appPackage: null,
        error: "",
        firstLoad: true,
        requestCompleted: false,
        username: "Buyer1"
      },
      usernameChange: jest.fn(),
      loadLaunchPad: jest.fn(),
      fetchAccounts: jest.fn(),
      appUploadRequest: jest.fn(),
      appSetError: jest.fn(),
      appReset: jest.fn(),
    }

    let wrapper = mount(
      <Provider store={store}>
        <MemoryRouter >
          <LaunchPad.WrappedComponent {...props} />
        </MemoryRouter>
      </Provider>)
    const fields = wrapper.find('Field')
    const dropZone = fields.at(3).find('Dropzone')
    files.push({
      lastModified: 1510147428520,
      name: "app.zip",
      preview: "blob:http://cd10.eastus.cloudapp.azure.com/16387655-5a30-4857-819e-275552978b45",
      size: 1725827,
      type: "application/zip",
      webkitRelativePath: ""
    })
    dropZone.simulate('drop', { dataTransfer: { files } })
    expect(props.appSetError).toHaveBeenCalledWith('Expected a zip archive, got multiple files')
  });

  test('file other than zip upload', () => {
    const props = {
      accounts: indexAccountsMock,
      launchPad: {
        appPackage: null,
        error: "",
        firstLoad: true,
        requestCompleted: false,
        username: "Buyer1"
      },
      usernameChange: jest.fn(),
      loadLaunchPad: jest.fn(),
      fetchAccounts: jest.fn(),
      appUploadRequest: jest.fn(),
      appSetError: jest.fn(),
      appReset: jest.fn(),
    }
    let wrapper = mount(
      <Provider store={store}>
        <MemoryRouter >
          <LaunchPad.WrappedComponent {...props} />
        </MemoryRouter>
      </Provider>)
    const fields = wrapper.find('Field')
    const dropZone = fields.at(3).find('Dropzone')
    const testFile = [{
      lastModified: 1510147428520,
      name: "abc.text",
      size: 1725827,
      type: "text/plain",
      webkitRelativePath: ""
    }]
    dropZone.simulate('drop', { dataTransfer: { files: testFile } })
    expect(props.appSetError).toHaveBeenCalledWith('Please upload a zip archive')
  });

  test('dropzone drag', () => {
    const props = {
      accounts: indexAccountsMock,
      launchPad: {
        appPackage: null,
        error: "",
        firstLoad: false,
        requestCompleted: false,
        username: "Buyer1"
      },
      usernameChange: jest.fn(),
      loadLaunchPad: jest.fn(),
      fetchAccounts: jest.fn(),
      appUploadRequest: jest.fn(),
      appSetError: jest.fn(),
      appReset: jest.fn(),
    }
    let wrapper = mount(
      <Provider store={store}>
        <MemoryRouter >
          <LaunchPad.WrappedComponent {...props} />
        </MemoryRouter>
      </Provider>)
    const fields = wrapper.find('Field')
    const dropZone = fields.at(3).find('Dropzone')
    const testFile = [{
      lastModified: 1510147428520,
      name: "abc.text",
      size: 1725827,
      type: "text/plain",
      webkitRelativePath: ""
    }]
    dropZone.simulate('dragEnter', { dataTransfer: { files: testFile } })
  });

  test('component will unmount', () => {
    const props = {
      accounts: indexAccountsMock,
      launchPad: {
        appPackage: null,
        error: "",
        firstLoad: true,
        requestCompleted: false,
        username: "Buyer1"
      },
      usernameChange: jest.fn(),
      loadLaunchPad: jest.fn(),
      fetchAccounts: jest.fn(),
      appUploadRequest: jest.fn(),
      appSetError: jest.fn(),
      appReset: jest.fn(),
    }
    let wrapper = mount(
      <Provider store={store}>
        <MemoryRouter >
          <LaunchPad.WrappedComponent {...props} />
        </MemoryRouter>
      </Provider>)
    wrapper.unmount()
    expect(props.appReset).toHaveBeenCalled()
  });

  test('component did update', () => {
    const props = {
      history: { push: jest.fn() },
      accounts: indexAccountsMock,
      launchPad: {
        appPackage: null,
        error: "",
        firstLoad: true,
        requestCompleted: true,
        username: "Buyer1"
      },
      usernameChange: jest.fn(),
      loadLaunchPad: jest.fn(),
      fetchAccounts: jest.fn(),
      appUploadRequest: jest.fn(),
      appSetError: jest.fn(),
      appReset: jest.fn(),
    }
    let wrapper = mount(
      <Provider store={store}>
        <MemoryRouter >
          <LaunchPad.WrappedComponent {...props} />
        </MemoryRouter>
      </Provider>)

    wrapper.update()
    expect(props.appReset).toHaveBeenCalled()
    expect(props.history.push).toHaveBeenCalled()
  });

})
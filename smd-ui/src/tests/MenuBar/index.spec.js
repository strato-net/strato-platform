import React from 'react';
import MenuBar, { mapStateToProps } from '../../components/MenuBar';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import * as checkMode from '../../lib/checkMode';

const PROMETHEUS_OFFSET = 0;
const BLOC_DOCS_OFFSET = 1;
const STRATO_DOCS_OFFSET = 2;
const LOGOUT_OFFSET = 3;

describe('MenuBar: index', () => {

  let store = createStore(combineReducers({ form: formReducer }));

  describe('renders public mode', () => {

    beforeEach(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(true);
    });

    test('component with values', () => {
      const props = {
        isLoggedIn: true,
        currentUser: { username: 'tanuj44' },
        openWalkThroughOverlay: jest.fn(),
        location: {
          search: '?developer'
        }
      }

      let wrapper = shallow(
        <Provider store={store}>
          <MemoryRouter>
            <MenuBar.WrappedComponent {...props} />
          </MemoryRouter>
        </Provider>
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('component without values', () => {
      const props = {
        isLoggedIn: false,
        currentUser: { username: '' },
        openWalkThroughOverlay: jest.fn(),
        location: {}
      }

      let wrapper = shallow(
        <Provider store={store}>
          <MemoryRouter>
            <MenuBar.WrappedComponent {...props} />
          </MemoryRouter>
        </Provider>
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    describe('button', () => {

      test('execute block api', () => {
        const props = {
          currentUser: { username: 'tanuj44' },
          isLoggedIn: true,
          openOverlay: jest.fn(),
          openLoginOverlay: jest.fn(),
          logout: jest.fn(),
          openWalkThroughOverlay: jest.fn(),
          location: {
            search: '?developer'
          }
        }

        let wrapper = shallow(
          <Provider store={store}>
            <MemoryRouter>
              <MenuBar.WrappedComponent {...props} />
            </MemoryRouter>
          </Provider>
        ).dive().dive().dive();

        wrapper.find('button').first().simulate('click');
        expect(wrapper.find('button').get(BLOC_DOCS_OFFSET)).toMatchSnapshot();
      });

      test('execute strato api', () => {
        const props = {
          currentUser: { username: 'tanuj44' },
          isLoggedIn: true,
          openOverlay: jest.fn(),
          openLoginOverlay: jest.fn(),
          logout: jest.fn(),
          openWalkThroughOverlay: jest.fn(),
          location: {
            search: "?developer"
          }
        }

        let wrapper = shallow(
          <Provider store={store}>
            <MemoryRouter>
              <MenuBar.WrappedComponent {...props} />
            </MemoryRouter>
          </Provider>
        ).dive().dive().dive();

        wrapper.find('button').at(STRATO_DOCS_OFFSET).simulate('click');
        expect(wrapper.find('button').get(STRATO_DOCS_OFFSET)).toMatchSnapshot();
      });

      test('execute logout', () => {
        const props = {
          currentUser: { username: 'tanuj44' },
          isLoggedIn: true,
          openOverlay: jest.fn(),
          openLoginOverlay: jest.fn(),
          logout: jest.fn(),
          openWalkThroughOverlay: jest.fn(),
          location: {
            search: "?developer"
          }
        }

        let wrapper = shallow(
          <Provider store={store}>
            <MemoryRouter>
              <MenuBar.WrappedComponent {...props} />
            </MemoryRouter>
          </Provider>
        ).dive().dive().dive();

        wrapper.find('button').at(LOGOUT_OFFSET).simulate('click');
        expect(wrapper.find('button').get(LOGOUT_OFFSET)).toMatchSnapshot();
        expect(props.logout).toHaveBeenCalled();
      });

      test('execute for developer', () => {
        const props = {
          currentUser: { username: 'tanuj44' },
          isLoggedIn: false,
          openLoginOverlay: jest.fn(),
          openWalkThroughOverlay: jest.fn(),
          location: {
            search: "?developer"
          }
        }

        let wrapper = shallow(
          <Provider store={store}>
            <MemoryRouter>
              <MenuBar.WrappedComponent {...props} />
            </MemoryRouter>
          </Provider>
        ).dive().dive().dive();

        wrapper.find('Button').last().simulate('click');
        expect(wrapper.find('Button').get(1)).toMatchSnapshot();
        expect(props.openWalkThroughOverlay).toHaveBeenCalled();
      });

    });

  });

  describe('renders enterprise mode', () => {

    beforeEach(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(false);
    });

    test('component with values', () => {
      const props = {
        isLoggedIn: true,
        currentUser: { username: 'tanuj44' },
        openWalkThroughOverlay: jest.fn(),
        location: {
          search: '?developer'
        }
      }

      let wrapper = shallow(
        <Provider store={store}>
          <MemoryRouter>
            <MenuBar.WrappedComponent {...props} />
          </MemoryRouter>
        </Provider>
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('component without values', () => {
      const props = {
        isLoggedIn: false,
        currentUser: { username: null },
        openWalkThroughOverlay: jest.fn(),
        location: {}
      }

      let wrapper = shallow(
        <Provider store={store}>
          <MemoryRouter>
            <MenuBar.WrappedComponent {...props} />
          </MemoryRouter>
        </Provider>
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    describe('button', () => {

      test('execute block api', () => {
        const props = {
          isLoggedIn: false,
          currentUser: { username: null },
          openOverlay: jest.fn(),
          openLoginOverlay: jest.fn(),
          logout: jest.fn(),
          openWalkThroughOverlay: jest.fn(),
          location: {
            search: '?developer'
          }
        }

        let wrapper = shallow(
          <Provider store={store}>
            <MemoryRouter>
              <MenuBar.WrappedComponent {...props} />
            </MemoryRouter>
          </Provider>
        ).dive().dive().dive();

        wrapper.find('button').first().simulate('click');
        expect(wrapper.find('button').get(BLOC_DOCS_OFFSET)).toMatchSnapshot();
      });

      test('execute strato api', () => {
        const props = {
          isLoggedIn: false,
          currentUser: { username: null },
          openOverlay: jest.fn(),
          openLoginOverlay: jest.fn(),
          logout: jest.fn(),
          openWalkThroughOverlay: jest.fn(),
          location: {
            search: "?developer"
          }
        }

        let wrapper = shallow(
          <Provider store={store}>
            <MemoryRouter>
              <MenuBar.WrappedComponent {...props} />
            </MemoryRouter>
          </Provider>
        ).dive().dive().dive();

        wrapper.find('button').at(STRATO_DOCS_OFFSET).simulate('click');
        expect(wrapper.find('button').get(STRATO_DOCS_OFFSET)).toMatchSnapshot();
      });

    });

  });

  test('mapStateToProps', () => {
    const state = {
      user: {
        "username": null,
        "currentUser": {
          "id": 6,
          "username": "tanuj41",
          "address": "86ee0c9644611495c0a1b1074e40d4e6db2f6b26"
        },
        "isLoggedIn": true,
        "error": null,
        "isOpen": false,
        "spinning": false
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });
});

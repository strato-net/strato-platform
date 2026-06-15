import React from 'react';
import MenuBar, { mapStateToProps } from '../../components/MenuBar';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import * as checkMode from '../../lib/checkMode';
import { oauthAccounts } from '../Accounts/accountsMock';

// FIXME: get rid of static offsets (spans are rendered dynamically based on strato configuration)
const PROMETHEUS_OFFSET = 0;
const BLOC_DOCS_OFFSET = 1;
const STRATO_DOCS_OFFSET = 2;

// FIXME: enable after ^ fixed
describe('MenuBar: index', () => {

  let store = createStore(combineReducers({ form: formReducer }));

  describe('renders Oauth mode', () => {

    beforeEach(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
    });

    test('component with values', () => {
      const props = {
        currentUser: { username: 'tanuj44' },
        chainIds: [
          { id: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9", label: "airline cartel 1" },
          { id: "558d611a3defd0bea21bb48a0fba099f63f8f5a088258526a4f81e68ada0379e", label: "airline cartel 2" },
          { id: "0353fd6fd7ef4b44fa5d1be0325fe312a5929f691e845dda132987ed74971a6f", label: "airline cartel 3" }],
        store: store,
        subscribeRoom: jest.fn(),
        unSubscribeRoom: jest.fn(),
        changeHealthStatus: jest.fn(),
        appMetadata: {},
        dashboard: {},
      }

      let wrapper = shallow(
        <MenuBar.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('component without values', () => {
      const props = {
        currentUser: { username: '' },
        subscribeRoom: jest.fn(),
        unSubscribeRoom: jest.fn(),
        changeHealthStatus: jest.fn(),
        appMetadata: {},
        dashboard: {},
        chainIds: [
          { id: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9", label: "airline cartel 1" },
          { id: "558d611a3defd0bea21bb48a0fba099f63f8f5a088258526a4f81e68ada0379e", label: "airline cartel 2" },
          { id: "0353fd6fd7ef4b44fa5d1be0325fe312a5929f691e845dda132987ed74971a6f", label: "airline cartel 3" }],
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

    test('mapStateToProps', () => {
      const state = {
        user: {
          oauthUser: oauthAccounts[0]
        },
        chains: {
          chainIds: [
            { id: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9", label: "airline cartel 1" },
            { id: "558d611a3defd0bea21bb48a0fba099f63f8f5a088258526a4f81e68ada0379e", label: "airline cartel 2" },
            { id: "0353fd6fd7ef4b44fa5d1be0325fe312a5929f691e845dda132987ed74971a6f", label: "airline cartel 3" }
          ]
        },
        search: {
          searchQuery: undefined,
        },
        user: {
          oauthUser: undefined,
        }
      }

      expect(mapStateToProps(state)).toMatchSnapshot();
    });

  });
});
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
          userCertificate: {
            address: "quxb0hj4dzgqwg83c52w0jvja6ukk022893z0w0k",
            block_hash: "dcvn97pwo8yoh1ep9iwdo6hdulk9uxtz1dehps53emm6tpznqz7eba3p5p7pqoqc",
            block_number: 107,
            block_timestamp: "2022-11-09 23:13:38 UTC",
            certificateString: "-----BEGIN CERTIFICATE-----\
            ZFu7U9gH/tPDNlYKwV0JofxMwMgUuvsgHdGeSJju4d300QNAOFgUV10WeUQBgK486lwUcvk6o8nAhJWYDFGbfnWcA8midQ6iicps/m7/T7fTu7V4M0vpldEWqfxekFuG/0AUyujhoqfwSfLJPmo0iQEP8LT3ilASHwzMjOetzeujV9tOemSm/3tKZcWkmqNx8ayKhb4mDdcclQ8zOAhNIkGBVd1fybuqqJHXLQC4yzbLHkWZ/OZTN2VhthECeF5ryiUUGZdOYxN2EFYnGPIIoqlpYsl4ab0gZvXK6bBw0vR/JvtpQPhuyw25VUIpa3UVAYRcdjABrAKjRovYdpEb8T002C4BnMCQMbWs8za6mhaG15zGQw5bRngQvbzjypVP7rlgyNJaaaPW0/EISVuSb1oycITPsxSneoUAHty1NfFaqRlFiH8hWAKVQ5nCiCAbjHDK03QjAmRecA82nn0DKZXqlf67LsKZN4KNbtKVEHCsTdivymmx3AokxtbMx2Ca3EIPc3h2Eykby3f7nR857UskcmL600HYs4tPIlF=\
              -----END CERTIFICATE-----\
              ",
            chainId: "",
            commonName: "clinicaladmin",
            country: "USA",
            isValid: true,
            organization: "BlockApps",
            organizationalUnit: "Engineering",
            owner: "6h2vbp7a08nevelwsyz6cnpuqr77diwi3wck720q",
            parent: "0000000000000000000000000000000000000000",
            publicKey: "-----BEGIN PUBLIC KEY-----\
              VRBEESfuZn6/YKyN8YQfL6uwbLFUPZFWTwZZswyXv6KRDbpXwBcQuoNuB5AIiQ9saR4yxBJRhaHLSQEZ/JzJBABTSxEWEtibIneBx0h8eAjVA3Zrpio9RMq/==\
              -----END PUBLIC KEY-----\
              ",
            record_id: "quxb0hj4dzgqwg83c52w0jvja6ukk022893z0w0k",
            transaction_hash: "9hj1qyqu52wqn45kgk5c6doy3go7qfm3beuze4dw4rfdps8ffgperqxb08qv4y72",
            transaction_sender: "a1n72r68azg8xgx5bnr6myz0npqs9setrw2tijoc",
            userAddress: "bzvlsnw1xpmipq866nuxkyjxb2crh0jcw1t8olbj",
          },
          oauthUser: undefined,
        }
      }

      expect(mapStateToProps(state)).toMatchSnapshot();
    });

  });
});
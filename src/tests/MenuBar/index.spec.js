import React from 'react';
import MenuBar, { mapStateToProps } from '../../components/MenuBar';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

describe('MenuBar: index', () => {

  let store = createStore(combineReducers({ form: formReducer }));

  test('render component', () => {
    let wrapper = shallow(
      <Provider store={store}>
        <MemoryRouter>
          <MenuBar.WrappedComponent isLoggedIn={true} currentUser={{ username: 'tanuj44' }} />
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
        logout: jest.fn()
      }

      let wrapper = shallow(
        <Provider store={store}>
          <MemoryRouter>
            <MenuBar.WrappedComponent {...props} />
          </MemoryRouter>
        </Provider>
      ).dive().dive().dive();

      wrapper.find('button').first().simulate('click');
      expect(wrapper.find('button').get(0)).toMatchSnapshot();
    });

    test('execute stato api', () => {
      const props = {
        currentUser: { username: 'tanuj44' },
        isLoggedIn: true,
        openOverlay: jest.fn(),
        openLoginOverlay: jest.fn(),
        logout: jest.fn()
      }

      let wrapper = shallow(
        <Provider store={store}>
          <MemoryRouter>
            <MenuBar.WrappedComponent {...props} />
          </MemoryRouter>
        </Provider>
      ).dive().dive().dive();

      wrapper.find('button').at(1).simulate('click');
      expect(wrapper.find('button').get(1)).toMatchSnapshot();
    });

    test('execute logout', () => {
      const props = {
        currentUser: { username: 'tanuj44' },
        isLoggedIn: true,
        openOverlay: jest.fn(),
        openLoginOverlay: jest.fn(),
        logout: jest.fn()
      }

      let wrapper = shallow(
        <Provider store={store}>
          <MemoryRouter>
            <MenuBar.WrappedComponent {...props} />
          </MemoryRouter>
        </Provider>
      ).dive().dive().dive();

      wrapper.find('button').at(2).simulate('click');
      expect(wrapper.find('button').get(2)).toMatchSnapshot();
      expect(props.logout).toHaveBeenCalled();
    });

    test('execute for developer', () => {
      const props = {
        currentUser: { username: 'tanuj44' },
        isLoggedIn: false,
        openOverlay: jest.fn(),
        openLoginOverlay: jest.fn()
      }

      let wrapper = shallow(
        <Provider store={store}>
          <MemoryRouter>
            <MenuBar.WrappedComponent {...props} />
          </MemoryRouter>
        </Provider>
      ).dive().dive().dive();

      wrapper.find('Button').first().simulate('click');
      expect(wrapper.find('Button').get(0)).toMatchSnapshot();
      expect(props.openLoginOverlay).toHaveBeenCalled();
    });

    test('execute signup', () => {
      const props = {
        currentUser: { username: 'tanuj44' },
        isLoggedIn: false,
        openLoginOverlay: jest.fn(),
        openWalkThroughOverlay: jest.fn()
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
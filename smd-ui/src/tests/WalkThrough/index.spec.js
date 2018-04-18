import WalkThrough, { mapStateToProps } from '../../components/WalkThrough'
import React from 'react'
import { reducer as formReducer } from 'redux-form'
import { createStore, combineReducers } from 'redux'

describe('WalkThrough: index', () => {

  describe('render component', () => {

    test('when modal is closed', () => {
      const store = createStore(combineReducers({ form: formReducer }));
      const props = {
        isWalkThroughOpen: false,
        store: store
      }
      const wrapper = shallow(
        <WalkThrough.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

    test('when modal is open', () => {
      const store = createStore(combineReducers({ form: formReducer }));
      const props = {
        isWalkThroughOpen: true,
        store: store
      }
      const wrapper = shallow(
        <WalkThrough.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

  })

  describe('changing steps', () => {

    const store = createStore(combineReducers({ form: formReducer }));
    const props = {
      isWalkThroughOpen: true,
      store: store,
      faucetRequest: jest.fn(),
      currentUser: {
        accountAddress: '123456789012345678901234567890123'
      }
    };
    let wrapper;
    beforeAll(() => {
      wrapper = shallow(
        <WalkThrough.WrappedComponent {...props} />
      );
    })

    test('step 1: renders createUser', () => {
      wrapper.setProps({ firstTimeUser: false });
      expect(wrapper).toMatchSnapshot();
    });

    test('step 2: renders verifyAccount', () => {
      wrapper.setProps({ firstTimeUser: true });
      expect(wrapper).toMatchSnapshot();
    });

    test('step 3: renders create password', () => {
      wrapper.setProps({ isTempPasswordVerified: true });
      expect(wrapper).toMatchSnapshot();
    });

    test('step 3: renders password creation successful', () => {
      wrapper.setProps({ isLoggedIn: true });
      expect(wrapper).toMatchSnapshot();
    });

    test('step 4: renders CLI', () => {
      wrapper.instance().handleContinue();
      wrapper.update();
      expect(wrapper).toMatchSnapshot();
      expect(props.faucetRequest).toHaveBeenCalledWith(props.currentUser.accountAddress);
    });
  })

  test('close modal on button click', () => {
    const store = createStore(combineReducers({ form: formReducer }));
    const props = {
      isWalkThroughOpen: true,
      store: store,
      closeWalkThroughOverlay: jest.fn()
    }
    const wrapper = shallow(
      <WalkThrough.WrappedComponent {...props} />
    ).find('Dialog').dive();
    wrapper.find('button').simulate('click');
    expect(props.closeWalkThroughOverlay).toHaveBeenCalled();
  })

  test('mapStateToProps with default state', () => {
    const state = {
      walkThrough: {
        isWalkThroughOpen: true,
        isLoggedIn: false
      },
      user: {
        currentUser: {
          accountAddress: '123456789012345678901234567890123'
        },
        firstTimeUser: true
      },
      verifyAccount: {
        isTempPasswordVerified: false
      }
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})
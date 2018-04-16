import React from 'react';
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';
import Faucet from '../../components/Faucet';

describe('Test Faucet index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
  });

  describe('render component', () => {
    test('without errors', () => {
      const props = {
        errors: {},
        handleSubmit: jest.fn(),
        submitting: false,
        store: store
      };

      const wrapper = shallow(
        <Faucet {...props} />
      ).dive().dive().dive();
      expect(wrapper.debug()).toMatchSnapshot();
    })

    test('with errors', () => {
      const props = {
        errors: {
          building: 'Please tell us what are you building'
        },
        handleSubmit: jest.fn(),
        submitting: false,
        store: store
      };

      const wrapper = shallow(
        <Faucet {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    })
  })

  test('simulate send email button click', () => {
    const props = {
      errors: {},
      handleSubmit: jest.fn(),
      submitting: false,
      currentUser: {
        accountAddress: '123456789012345678901234567890123'
      },
      faucetRequest: jest.fn(),
      accountAddress: '123456789012345678901234567890123',
      store: store
    };

    const wrapper = shallow(
      <Faucet {...props} />
    ).dive().dive().dive();

    wrapper.find('Field').simulate('change', { target: { value: "test" } });
    wrapper.find('Button').simulate('click');
    expect(props.handleSubmit).toHaveBeenCalled();
    wrapper.instance().submit({ building: "test" });
    expect(props.faucetRequest).toHaveBeenCalledWith(props.accountAddress);
    wrapper.update();
    expect(wrapper.debug()).toMatchSnapshot();
  })

})

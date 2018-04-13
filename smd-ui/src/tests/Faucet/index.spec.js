import React from 'react';
import Faucet from '../../components/Faucet';

describe('Test Faucet index', () => {

  describe('render component', () => {
    test('without errors', () => {
      const props = {
        errors: {},
        handleSubmit: jest.fn(),
        submitting: false
      };

      const wrapper = shallow(
        <Faucet {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    })

    test('with errors', () => {
      const props = {
        errors: {
          building: 'Please tell us what are you building'
        },
        handleSubmit: jest.fn(),
        submitting: false
      };

      const wrapper = shallow(
        <Faucet {...props} />
      );

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
      accountAddress: '123456789012345678901234567890123'
    };

    const wrapper = shallow(
      <Faucet {...props} />
    );

    wrapper.find('Field').simulate('change', { target: { value: "test" } });
    wrapper.find('Button').simulate('click');
    expect(props.handleSubmit).toHaveBeenCalled();
    wrapper.instance().submit({ building: "test" });
    expect(props.faucetRequest).toHaveBeenCalledWith(props.accountAddress);
    wrapper.update();
    expect(wrapper.debug()).toMatchSnapshot();
  })

})

import React from 'react';
import VerifyAccount, { mapStateToProps } from '../../components/VerifyAccount';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';
import { Provider } from 'react-redux';

describe('VerifyAccount: index', () => {

  let store = createStore(combineReducers({ form: formReducer }));

  describe('render component', () => {

    test('without values', () => {
      const props = {
        store: store
      }
      let wrapper = shallow(
        <VerifyAccount.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        email: 'no-reply@blockapps.net',
        resetError: jest.fn(),
        verifyTempPassword: jest.fn(),
        handleSubmit: jest.fn(),
        store: store
      }
      let wrapper = shallow(
        <VerifyAccount.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('Form:', () => {

    test('simulate fields', () => {
      const props = {
        email: 'no-reply@blockapps.net',
        resetError: jest.fn(),
        verifyTempPassword: jest.fn(),
        handleSubmit: jest.fn()
      }

      let wrapper = mount(
        <Provider store={store}>
          <VerifyAccount.WrappedComponent {...props} />
        </Provider>
      );

      wrapper.find('Field').at(0).simulate('change', { target: { value: 'Supplier1' } });
      wrapper.find('Button').first().simulate('click');
      expect(store.getState().form['verifyAccount']).toMatchSnapshot();
    });

    describe('simulate submit', () => {

      test('with validation', () => {
        const props = {
          email: 'no-reply@blockapps.net',
          resetError: jest.fn(),
          verifyTempPassword: jest.fn(),
          handleSubmit: jest.fn(),
          store: store
        }

        let wrapper = shallow(
          <VerifyAccount.WrappedComponent {...props} />
        ).dive().dive().dive();

        wrapper.instance().submit({ tempPassword: 'asdsakjd' });
        expect(props.verifyTempPassword).toHaveBeenCalled();
        expect(props.verifyTempPassword).toHaveBeenCalledTimes(1);
      });

      test('without validation', () => {
        const props = {
          email: 'no-reply@blockapps.net',
          resetError: jest.fn(),
          verifyTempPassword: jest.fn(),
          handleSubmit: jest.fn(),
          store: store
        }

        let wrapper = shallow(
          <VerifyAccount.WrappedComponent {...props} />
        ).dive().dive().dive();

        wrapper.instance().submit({ tempPassword: null });
        expect(props.verifyTempPassword).not.toHaveBeenCalled();
        expect(props.verifyTempPassword).not.toHaveBeenCalledTimes(1);
      });
    });

    describe('errorMessageFor', () => {

      test('with error', () => {
        const props = {
          email: 'no-reply@blockapps.net',
          resetError: jest.fn(),
          verifyTempPassword: jest.fn(),
          handleSubmit: jest.fn(),
          store: store
        }

        let wrapper = shallow(
          <VerifyAccount.WrappedComponent {...props} />
        ).dive().dive().dive();

        wrapper.setState({ errors: { tempPassword: 'error' } });
        expect(wrapper.instance().errorMessageFor('tempPassword')).toMatchSnapshot();

      });

      test('without error', () => {
        const props = {
          email: 'no-reply@blockapps.net',
          resetError: jest.fn(),
          verifyTempPassword: jest.fn(),
          handleSubmit: jest.fn(),
          store: store
        }

        let wrapper = shallow(
          <VerifyAccount.WrappedComponent {...props} />
        ).dive().dive().dive();

        expect(wrapper.instance().errorMessageFor('tempPassword')).toMatchSnapshot();
      });

    });

  });

  test('componentWillReceiveProps', () => {
    const props = {
      email: 'no-reply@blockapps.net',
      resetError: jest.fn(),
      verifyTempPassword: jest.fn(),
      handleSubmit: jest.fn(),
      store: store
    }

    let wrapper = shallow(
      <VerifyAccount.WrappedComponent {...props} />
    ).dive().dive().dive();

    const newProps = {
      serverError: 'Error occured'
    }

    wrapper.instance().componentWillReceiveProps(newProps);
    expect(props.resetError).toHaveBeenCalled();
    expect(props.resetError).toHaveBeenCalledTimes(1);
  });

  test('mapStateToProps', () => {
    const state = {
      verifyAccount: {
        isOpen: true,
        error: null
      },
      user: {
        firstTimeUser: true
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();

  });

});

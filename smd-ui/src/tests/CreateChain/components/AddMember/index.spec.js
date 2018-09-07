import React from 'react';
import AddMember, { mapStateToProps } from '../../../../components/CreateChain/components/AddMember';
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';
import * as checkMode from '../../../../lib/checkMode';
import { indexAccountsMock } from '../../../Accounts/accountsMock';

describe('CreateChain: index', () => {

  let store;

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  });

  describe('render component (enterprise mode)', () => {

    beforeAll(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(false);
    })

    test('with empty values', () => {
      const props = {
        accounts: [],
        initialValues: {
          fromAddress: null
        },
        fetchAccounts: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        accounts: indexAccountsMock,
        initialValues: {
          fromAddress: null,
          from: null
        },
        fetchAccounts: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('form fields', () => {
      const props = {
        accounts: indexAccountsMock,
        initialValues: {
          fromAddress: null,
          from: null
        },
        fetchAccounts: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handler: jest.fn(),
        reset: jest.fn(),
        closeAddMemberModal: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.state()).toMatchSnapshot();
      wrapper.find('Field').first().simulate('change', { target: { value: 'Supplier1' } });
      expect(props.fetchUserAddresses).toHaveBeenCalled();
      wrapper.find('Field').at(1).simulate('change', { target: { value: '370adf114257cb0e0025eedf0a96261b51af23e3' } });
      wrapper.find('Field').at(2).simulate('change', { target: { value: 'enode://' } });
      wrapper.find('Field').at(3).simulate('change', { target: { value: '500' } });
      expect(wrapper.state()).toMatchSnapshot();

      // console.log(wrapper.find('Button'))
      wrapper.find('Button').last().simulate('click');
      expect(props.handler).toHaveBeenCalled();
      expect(props.handler).toHaveBeenCalledTimes(1);
      expect(props.closeAddMemberModal).toHaveBeenCalled();
      expect(props.closeAddMemberModal).toHaveBeenCalledTimes(1);
    });

    test('errorMessageFor', () => {
      const props = {
        accounts: indexAccountsMock,
        initialValues: {
          fromAddress: null,
          from: null
        },
        fetchAccounts: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handler: jest.fn(),
        reset: jest.fn(),
        closeAddMemberModal: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.instance().errorMessageFor('username')).toMatchSnapshot();
      wrapper.setState({ errors: { username: 'required' } })
      expect(wrapper.instance().errorMessageFor('username')).toMatchSnapshot()
    });

  });

  describe('render component (public mode)', () => {

    beforeAll(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(true);
    })

    test('with empty values', () => {
      const props = {
        accounts: [],
        initialValues: {
          fromAddress: null
        },
        fetchAccounts: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        accounts: [],
        initialValues: {
          fromAddress: '370adf114257cb0e0025eedf0a96261b51af23e3',
          from: 'Supplier1'
        },
        fetchAccounts: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    describe('form fields', () => {

      test('with values', () => {
        const props = {
          accounts: indexAccountsMock,
          initialValues: {
            fromAddress: '370adf114257cb0e0025eedf0a96261b51af23e3',
            from: 'Supplier1'
          },
          fetchAccounts: jest.fn(),
          fetchUserAddresses: jest.fn(),
          handler: jest.fn(),
          reset: jest.fn(),
          closeAddMemberModal: jest.fn(),
          store: store
        };

        const wrapper = shallow(
          <AddMember.WrappedComponent {...props} />
        ).dive().dive().dive();

        expect(wrapper.state()).toMatchSnapshot();
        wrapper.find('Field').at(2).simulate('change', { target: { value: 'enode://' } });
        wrapper.find('Field').at(3).simulate('change', { target: { value: '500' } });
        expect(wrapper.state()).toMatchSnapshot();
        wrapper.find('Button').last().simulate('click');
        expect(props.handler).toHaveBeenCalled();
        expect(props.handler).toHaveBeenCalledTimes(1);
        expect(props.closeAddMemberModal).toHaveBeenCalled();
        expect(props.closeAddMemberModal).toHaveBeenCalledTimes(1);
      });

      test('without values', () => {
        const props = {
          accounts: indexAccountsMock,
          initialValues: {
            fromAddress: '370adf114257cb0e0025eedf0a96261b51af23e3',
            from: 'Supplier1'
          },
          fetchAccounts: jest.fn(),
          fetchUserAddresses: jest.fn(),
          handler: jest.fn(),
          reset: jest.fn(),
          closeAddMemberModal: jest.fn(),
          store: store
        };

        const wrapper = shallow(
          <AddMember.WrappedComponent {...props} />
        ).dive().dive().dive();

        wrapper.find('Button').last().simulate('click');
        expect(props.handler).not.toHaveBeenCalled();
        expect(props.handler).not.toHaveBeenCalledTimes(1);
        expect(props.closeAddMemberModal).not.toHaveBeenCalled();
        expect(props.closeAddMemberModal).not.toHaveBeenCalledTimes(1);
      });

    });

  });

  describe('add member modal', () => {

    test('open modal', () => {
      const props = {
        accounts: indexAccountsMock,
        initialValues: {
          fromAddress: '370adf114257cb0e0025eedf0a96261b51af23e3',
          from: 'Supplier1'
        },
        fetchAccounts: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handler: jest.fn(),
        reset: jest.fn(),
        openAddMemberModal: jest.fn(),
        closeAddMemberModal: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.find('Button').first().simulate('click');
      expect(props.openAddMemberModal).toHaveBeenCalled();
      expect(props.openAddMemberModal).toHaveBeenCalledTimes(1);
    });

    test('close modal', () => {
      const props = {
        accounts: indexAccountsMock,
        initialValues: {
          fromAddress: '370adf114257cb0e0025eedf0a96261b51af23e3',
          from: 'Supplier1'
        },
        fetchAccounts: jest.fn(),
        fetchUserAddresses: jest.fn(),
        handler: jest.fn(),
        reset: jest.fn(),
        openAddMemberModal: jest.fn(),
        closeAddMemberModal: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.find('Button').at(1).simulate('click');
      expect(props.closeAddMemberModal).toHaveBeenCalled();
      expect(props.closeAddMemberModal).toHaveBeenCalledTimes(1);
    });

  });

  test('mapStateToProps with default state', () => {
    const state = {
      createChain: {
        isAddMemberModalOpen: true
      },
      accounts: {
        accounts: indexAccountsMock
      },
      user: {
        currentUser: {
          username: 'Supplier2_1301_46441',
          accountAddress: '57f2ed9058d2e868d7bbae9db03af12d27675117'
        }
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});
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

  describe('render component (non Oauth mode)', () => {

    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
    })

    test('with empty values', () => {
      const props = {
        initialValues: {
        },
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        initialValues: {
        },
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('form fields', () => {
      const props = {
        initialValues: {
        },
        handler: jest.fn(),
        reset: jest.fn(),
        closeAddMemberModal: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.state()).toMatchSnapshot();

      // on address radio selection
      wrapper.find('Field').first().simulate('click');
      wrapper.find('Field').at(1).simulate('change', { target: { value: 'BlockApps' } });
      wrapper.find('Field').at(2).simulate('change', { target: { value: 'Engineering' } });
      wrapper.find('Field').at(3).simulate('change', { target: { value: 'James Hormuzdiar' } });
      wrapper.find('Field').at(4).simulate('change', { target: { value: true } });
      expect(wrapper.state()).toMatchSnapshot();

      // on user radio selection
      wrapper.find('Field').at(1).simulate('click');
      wrapper.find('Field').at(1).simulate('change', { target: { value: 'BlockApps' } });
      wrapper.find('Field').at(2).simulate('change', { target: { value: 'Engineering' } });
      wrapper.find('Field').at(3).simulate('change', { target: { value: 'James Hormuzdiar' } });
      wrapper.find('Field').at(4).simulate('change', { target: { value: false } });
      // console.log(wrapper.state());
      expect(wrapper.state()).toMatchSnapshot();

      wrapper.find('Button').last().simulate('click');
      expect(props.handler).toHaveBeenCalled();
      expect(props.handler).toHaveBeenCalledTimes(1);
      expect(props.closeAddMemberModal).toHaveBeenCalled();
      expect(props.closeAddMemberModal).toHaveBeenCalledTimes(1);
    });

    test('errorMessageFor', () => {
      const props = {
        initialValues: {
        },
        handler: jest.fn(),
        reset: jest.fn(),
        closeAddMemberModal: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.instance().errorMessageFor('orgName')).toMatchSnapshot();
      wrapper.setState({ errors: { username: 'required' } })
      expect(wrapper.instance().errorMessageFor('orgName')).toMatchSnapshot()
    });

  });

  describe('render component (Oauth mode)', () => {

    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
    })

    test('with empty values', () => {
      const props = {
        initialValues: {
        },
        store: store
      };

      const wrapper = shallow(
        <AddMember.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        initialValues: {
        },
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
          isOpen: true,
          initialValues: {
          },
          handler: jest.fn(),
          reset: jest.fn(),
          closeAddMemberModal: jest.fn(),
          store: store
        };

        const wrapper = shallow(
          <AddMember.WrappedComponent {...props} />
        ).dive().dive().dive();

        expect(wrapper.state()).toMatchSnapshot();
        wrapper.find('Field').at(1).simulate('change', { target: { value: 'BlockApps' } });
        wrapper.find('Field').at(2).simulate('change', { target: { value: 'Engineering' } });
        wrapper.find('Field').at(3).simulate('change', { target: { value: 'James Hormuzdiar' } });
        expect(wrapper.state()).toMatchSnapshot();
        wrapper.find('Button').last().simulate('click');
        expect(props.handler).toHaveBeenCalled();
        expect(props.handler).toHaveBeenCalledTimes(1);
        expect(props.closeAddMemberModal).toHaveBeenCalled();
        expect(props.closeAddMemberModal).toHaveBeenCalledTimes(1);
      });

      test('without values', () => {
        const props = {
          initialValues: {
          },
          handler: jest.fn(),
          reset: jest.fn(),
          closeAddMemberModal: jest.fn(),
          store: store
        };

        const wrapper = shallow(
          <AddMember.WrappedComponent {...props} />
        ).dive().dive().dive();
        wrapper.find('Field').at(2).simulate('change', { target: { value: '' } });
        wrapper.find('Button').last().simulate('click');
        expect(props.handler).toHaveBeenCalled();
        expect(props.handler).toHaveBeenCalledTimes(1);
        expect(props.closeAddMemberModal).toHaveBeenCalled();
        expect(props.closeAddMemberModal).toHaveBeenCalledTimes(1);
      });

    });

  });

  describe('add member modal', () => {

    test('open modal', () => {
      const props = {
        initialValues: {
        },
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
        initialValues: {
        },
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
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});
import React from 'react';
import AddIntegration, { mapStateToProps } from '../../../../components/CreateChain/components/AddIntegration';
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';
import * as checkMode from '../../../../lib/checkMode';
import { chain } from '../../../Chains/chainsMock';

describe('AddIntegration: index', () => {

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
          name: "",
          chainLabel: "",
          chainId: ""
        },
        chainLabel: chain,
        chainLabelIds: chain["airline cartel 9"],
        fetchChainIds: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddIntegration.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        initialValues: {
          name: "",
          chainLabel: "",
          chainId: ""
        },
        chainLabel: "",
        chainLabelIds: [],
        store: store
      };

      const wrapper = shallow(
        <AddIntegration.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('form fields', () => {
      const props = {
        initialValues: {
          name: "",
          chainLabel: "",
          chainId: ""
        },
        chainLabel: "",
        chainLabelIds: [],
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
        handler: jest.fn(),
        reset: jest.fn(),
        closeAddIntegrationModal: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddIntegration.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.state()).toMatchSnapshot();

      // on address radio selection
      wrapper.find('Field').first().simulate('click');
      wrapper.find('Field').first().simulate('change', { target: { value: 'bank' } });
      wrapper.find('Field').at(1).simulate('change', { target: { value: 'deadbeef' } });
      expect(wrapper.state()).toMatchSnapshot();

      // on user radio selection
      wrapper.find('Field').first().simulate('click');
      wrapper.find('Field').first().simulate('change', { target: { value: 'weather' } });
      wrapper.find('Field').at(1).simulate('change', { target: { value: 'feedbeef' } });
      // console.log(wrapper.state());
      expect(wrapper.state()).toMatchSnapshot();

      wrapper.find('Button').last().simulate('click');
      expect(props.handler).toHaveBeenCalled();
      expect(props.handler).toHaveBeenCalledTimes(1);
      expect(props.closeAddIntegrationModal).toHaveBeenCalled();
      expect(props.closeAddIntegrationModal).toHaveBeenCalledTimes(1);
    });

    test('errorMessageFor', () => {
      const props = {
        initialValues: {
          name: "",
          chainLabel: "",
          chainId: ""
        },
        chainLabel: "",
        chainLabelIds: [],
        handler: jest.fn(),
        reset: jest.fn(),
        closeAddIntegrationModal: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddIntegration.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.instance().errorMessageFor('name')).toMatchSnapshot();
      wrapper.setState({ errors: { username: 'required' } })
      expect(wrapper.instance().errorMessageFor('name')).toMatchSnapshot()
    });

  });

  describe('render component (Oauth mode)', () => {

    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
    })

    test('with empty values', () => {
      const props = {
        initialValues: {
          name: "",
          chainLabel: "",
          chainId: ""
        },
        chainLabel: "",
        chainLabelIds: [],
        store: store
      };

      const wrapper = shallow(
        <AddIntegration.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        initialValues: {
          name: "",
          chainLabel: "",
          chainId: ""
        },
        chainLabel: "",
        chainLabelIds: [],
        store: store
      };

      const wrapper = shallow(
        <AddIntegration.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    describe('form fields', () => {

      test('with values', () => {
        const props = {
          isOpen: true,
          initialValues: {
            name: "",
            chainLabel: "",
            chainId: ""
          },
          chainLabel: "",
          chainLabelIds: [],
          fetchChainIds: jest.fn(),
          getLabelIds: jest.fn(),
          handler: jest.fn(),
          reset: jest.fn(),
          closeAddIntegrationModal: jest.fn(),
          store: store
        };

        const wrapper = shallow(
          <AddIntegration.WrappedComponent {...props} />
        ).dive().dive().dive();

        expect(wrapper.state()).toMatchSnapshot();
        wrapper.find('Field').first().simulate('change', { target: { value: 'bank' } });
        wrapper.find('Field').at(1).simulate('change', { target: { value: 'deadbeef' } });
        expect(wrapper.state()).toMatchSnapshot();
        wrapper.find('Button').last().simulate('click');
        expect(props.handler).toHaveBeenCalled();
        expect(props.handler).toHaveBeenCalledTimes(1);
        expect(props.closeAddIntegrationModal).toHaveBeenCalled();
        expect(props.closeAddIntegrationModal).toHaveBeenCalledTimes(1);
      });

      test('without values', () => {
        const props = {
          initialValues: {
            name: "",
            chainLabel: "",
            chainId: ""
          },
          chainLabel: "",
          chainLabelIds: [],
          fetchChainIds: jest.fn(),
          getLabelIds: jest.fn(),
          handler: jest.fn(),
          reset: jest.fn(),
          closeAddIntegrationModal: jest.fn(),
          store: store
        };

        const wrapper = shallow(
          <AddIntegration.WrappedComponent {...props} />
        ).dive().dive().dive();
        wrapper.find('Field').at(1).simulate('change', { target: { value: '' } });
        wrapper.find('Button').last().simulate('click');
        expect(props.handler).toHaveBeenCalled();
        expect(props.handler).toHaveBeenCalledTimes(1);
        expect(props.closeAddIntegrationModal).toHaveBeenCalled();
        expect(props.closeAddIntegrationModal).toHaveBeenCalledTimes(1);
      });

    });

  });

  describe('add integration modal', () => {

    test('open modal', () => {
      const props = {
        initialValues: {
          name: "",
          chainLabel: "",
          chainId: ""
        },
        chainLabel: "",
        chainLabelIds: [],
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
        handler: jest.fn(),
        reset: jest.fn(),
        openAddIntegrationModal: jest.fn(),
        closeAddIntegrationModal: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddIntegration.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.find('Button').first().simulate('click');
      expect(props.openAddIntegrationModal).toHaveBeenCalled();
      expect(props.openAddIntegrationModal).toHaveBeenCalledTimes(1);
    });

    test('close modal', () => {
      const props = {
        initialValues: {
          name: "",
          chainLabel: "",
          chainId: ""
        },
        chainLabel: "",
        chainLabelIds: [],
        handler: jest.fn(),
        closeAddIntegrationModal: jest.fn(),
        store: store
      };

      const wrapper = shallow(
        <AddIntegration.WrappedComponent {...props} />
      ).dive().dive().dive();

      wrapper.find('Button').at(1).simulate('click');
      expect(props.closeAddIntegrationModal).toHaveBeenCalled();
      expect(props.closeAddIntegrationModal).toHaveBeenCalledTimes(1);
    });

  });

  test('mapStateToProps with default state', () => {
    const state = {
      createChain: {
        isAddIntegrationModalOpen: true
      },
      chains: {
        chainIds: [],
        listChain: chain,
        listLabelIds: chain["airline cartel 9"]
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});
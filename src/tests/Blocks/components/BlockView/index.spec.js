import React from 'react';
import BlockView, { mapStateToProps } from '../../../../components/Blocks/components/BlockView/index';
import { blocksMock } from '../../../BlockData/blockDataMock';

describe('BlockView: index', () => {

  describe('render component', () => {

    test('without values', () => {
      const props = {
        match: {
          params: {
            block: undefined
          }
        },
        block: undefined,
        fetchBlockData: jest.fn()
      };

      const wrapper = shallow(
        <BlockView.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        match: {
          params: {
            block: 210
          }
        },
        block: blocksMock[0],
        fetchBlockData: jest.fn()
      };

      const wrapper = shallow(
        <BlockView.WrappedComponent {...props} />
      );

      expect(wrapper).toMatchSnapshot();
    });

  });

  describe('button', () => {

    test('back to blocks list', () => {
      const props = {
        match: {
          params: {
            block: 210
          }
        },
        block: blocksMock[0],
        history: {
          goBack: jest.fn()
        },
        fetchBlockData: jest.fn()
      };

      const wrapper = shallow(
        <BlockView.WrappedComponent {...props} />
      );

      wrapper.find('Button').simulate('click');
      expect(props.history.goBack).toHaveBeenCalled();
      expect(props.history.goBack.mock.calls.length).toBe(1);
    });

  });

  describe('mapStateToProps', () => {

    test('return block when blockData is empty', () => {
      const ownProps = {
        match: {
          params: {
            block: 210
          }
        }
      };
      const state = {
        blockData: { blockData: [] },
        queryEngine: { queryResult: blocksMock }
      };

      expect(mapStateToProps(state, ownProps)).toMatchSnapshot();
    });

    test('return block when queryEngine is empty', () => {
      const ownProps = {
        match: {
          params: {
            block: 210
          }
        }
      };
      const state = {
        blockData: { blockData: blocksMock },
        queryEngine: { queryResult: [] }
      };

      expect(mapStateToProps(state, ownProps)).toMatchSnapshot();
    });

  });

});
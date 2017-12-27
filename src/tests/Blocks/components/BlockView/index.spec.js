import React from 'react';
import BlockView, { mapStateToProps } from '../../../../components/Blocks/components/BlockView/index';
import { blocksMock } from '../../../BlockData/blockDataMock';

describe('Test BlockView index', () => {

  test('should render component with empty values', () => {
    const props = {
      match: {
        params: {
          block: undefined
        }
      },
      block: undefined,
      fetchBlockData: jest.fn()
    }

    const wrapper = shallow(
      <BlockView.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should render component with mocked values', () => {
    const props = {
      match: {
        params: {
          block: 210
        }
      },
      block: blocksMock[0],
      fetchBlockData: jest.fn()
    }

    const wrapper = shallow(
      <BlockView.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should back on click', () => {
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
    }

    const wrapper = shallow(
      <BlockView.WrappedComponent {...props} />
    );

    wrapper.find('Button').simulate('click');
    expect(props.history.goBack).toHaveBeenCalled();
    expect(props.history.goBack.mock.calls.length).toBe(1);
  });

  describe('mapStateToProps', () => {

    test('should return block when blockData is empty', () => {
      const ownProps = {
        match: {
          params: {
            block: 210
          }
        }
      }

      const state = {
        blockData: { blockData: [] },
        queryEngine: { queryResult: blocksMock }
      }

      expect(mapStateToProps(state, ownProps)).toMatchSnapshot();
    });

    test('should return block when queryEngine is empty', () => {
      const ownProps = {
        match: {
          params: {
            block: 210
          }
        }
      }

      const state = {
        blockData: { blockData: blocksMock },
        queryEngine: { queryResult: [] }
      }

      expect(mapStateToProps(state, ownProps)).toMatchSnapshot();
    });

  });

});
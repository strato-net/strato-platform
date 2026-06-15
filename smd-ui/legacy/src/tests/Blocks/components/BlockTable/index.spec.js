import React from 'react';
import BlockTable, {
  mapStateToProps
} from '../../../../components/Blocks/components/BlockTable/index';
import { blocksMock } from '../../../BlockData/blockDataMock';
import { Provider } from 'react-redux';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';

describe('BlockTable: index', () => {

  let store;
  let mockFunction;

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
    mockFunction = {
      fetchBlockData: jest.fn(),
      executeQuery: jest.fn(),
      clearQuery: jest.fn(),
      updateQuery: jest.fn(),
      dispatch: jest.fn(),
      removeQuery: jest.fn(),
    };
  });

  describe('render component', () => {

    test('with values', () => {
      const props = {
        history: {},
        query: { last: 15 },
        queryResult: blocksMock,
        store: store,
        ...mockFunction
      }

      const wrapper = shallow(
        <BlockTable.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper).toMatchSnapshot();
    });

    test('without values', () => {
      const props = {
        history: {},
        query: {},
        queryResult: [],
        store: store,
        ...mockFunction
      }

      const wrapper = shallow(
        <BlockTable.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper).toMatchSnapshot();
    });

  });

  test('remove query on cancel', () => {
    const props = {
      history: {},
      query: { last: 15 },
      queryResult: blocksMock,
      ...mockFunction
    }

    const wrapper = mount(
      <Provider store={store}>
        <BlockTable.WrappedComponent {...props} />
      </Provider>
    );

    wrapper.find('button').last().simulate('click');
    expect(props.removeQuery).toHaveBeenCalled();
    expect(props.removeQuery.mock.calls.length).toBe(1);
  });

  test('refresh blocks', () => {
    const props = {
      history: {},
      query: { last: 15 },
      queryResult: blocksMock,
      ...mockFunction
    }

    const wrapper = mount(
      <Provider store={store}>
        <BlockTable.WrappedComponent {...props} />
      </Provider>
    );

    wrapper.find('button').first().simulate('click');
    expect(props.clearQuery).toHaveBeenCalled();
    expect(props.clearQuery.mock.calls.length).toBe(1);
    expect(props.executeQuery).toHaveBeenCalled();
    expect(props.executeQuery.mock.calls.length).toBe(2);
  });

  test('view block detail on click', () => {
    const props = {
      history: {
        push: jest.fn()
      },
      query: { last: 15 },
      queryResult: blocksMock,
      ...mockFunction
    }

    const wrapper = mount(
      <Provider store={store}>
        <BlockTable.WrappedComponent {...props} />
      </Provider>
    );

    wrapper.find('tr').last().simulate('click');
    expect(props.history.push).toHaveBeenCalled();
    expect(props.history.push.mock.calls.length).toBe(1);
    expect(props.history.push.mock.calls).toEqual([["/blocks/206"]]);
  });

  describe('form', () => {

    test('required', () => {
      const props = {
        history: {
          push: jest.fn()
        },
        query: { last: 15 },
        queryResult: blocksMock,
        ...mockFunction
      }

      const wrapper = mount(
        <Provider store={store}>
          <BlockTable.WrappedComponent {...props} />
        </Provider>
      );

      wrapper.find('Field').at(1).simulate('keypress', { key: '' });
      expect(store.getState().form['block-query']).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        history: {
          push: jest.fn()
        },
        query: { last: 15 },
        queryResult: blocksMock,
        ...mockFunction
      }

      const wrapper = mount(
        <Provider store={store}>
          <BlockTable.WrappedComponent {...props} />
        </Provider>
      );

      wrapper.find('Field').at(1).simulate('keypress', { key: 'Enter' });
      wrapper.find('Field').at(0).simulate('change', { target: { value: 'maxnumber' } });
      wrapper.find('Field').at(1).simulate('change', { target: { value: 1522 } });
      wrapper.find('Button').at(1).simulate('click');
      expect(store.getState().form['block-query']).toMatchSnapshot();
    });

    test('submit method', () => {
      const props = {
        history: {
          push: jest.fn()
        },
        query: { last: 15 },
        queryResult: blocksMock,
        store: store,
        ...mockFunction
      }

      const wrapper = shallow(
        <BlockTable.WrappedComponent {...props} />
      ).dive().dive().dive();

      const values = {
        query: { last: 15 },
        value: 'text'
      };

      wrapper.instance().submit(values);
      expect(props.updateQuery).toHaveBeenCalled();
    });

  });

  test('componentDidMount', () => {
    const props = {
      history: {},
      query: { last: 15 },
      queryResult: blocksMock,
      ...mockFunction
    }

    const wrapper = mount(
      <Provider store={store}>
        <BlockTable.WrappedComponent {...props} />
      </Provider>
    );

    expect(props.fetchBlockData).toHaveBeenCalled();
    expect(props.fetchBlockData.mock.calls.length).toBe(1);
    expect(props.executeQuery).toHaveBeenCalled();
    expect(props.executeQuery.mock.calls.length).toBe(1);
  });

  test('componentWillUnmount', () => {
    const props = {
      history: {},
      query: { last: 15 },
      queryResult: blocksMock,
      store: store,
      ...mockFunction
    }

    const wrapper = shallow(
      <BlockTable.WrappedComponent {...props} />
    ).dive();

    wrapper.dive().dive().instance().componentWillUnmount();
    expect(props.clearQuery).toHaveBeenCalled();
    expect(props.clearQuery.mock.calls.length).toBe(1);
  });

  test('componentWillReceiveProps', () => {
    const props = {
      history: {},
      query: { last: 15 },
      queryResult: blocksMock,
      store: store,
      ...mockFunction
    }

    const newProps = {
      query: {},
      executeQuery: jest.fn()
    }

    const wrapper = shallow(
      <BlockTable.WrappedComponent {...props} />
    ).dive();

    wrapper.dive().dive().instance().componentWillReceiveProps(newProps);
    expect(newProps.executeQuery).toHaveBeenCalled();
    expect(newProps.executeQuery.mock.calls.length).toBe(1);
  });

  test('mapStateToProps', () => {
    const state = {
      queryEngine: {
        query: { last: 15 },
        queryResult: blocksMock
      },
      chains: {
        selectedChain: 'airline cartel 1'
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});
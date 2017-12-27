import React from 'react';
import BlockTable, {
  mapStateToProps
} from '../../../../components/Blocks/components/BlockTable/index';
import { blocksMock } from '../../../BlockData/blockDataMock';
import { Provider } from 'react-redux';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';

describe('Test Blocks index', () => {

  let store;

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  })

  test('should render component with mocked values', () => {
    const props = {
      history: {},
      query: { last: 15 },
      queryResult: blocksMock,
      fetchBlockData: jest.fn(),
      executeQuery: jest.fn(),
      clearQuery: jest.fn(),
      updateQuery: jest.fn(),
      dispatch: jest.fn(),
      removeQuery: jest.fn(),
      store: store
    }

    const wrapper = shallow(
      <BlockTable.WrappedComponent {...props} />
    ).dive().dive().dive();

    expect(wrapper).toMatchSnapshot();
  });

  test('should render component without mock', () => {
    const props = {
      history: {},
      query: {},
      queryResult: [],
      fetchBlockData: jest.fn(),
      executeQuery: jest.fn(),
      clearQuery: jest.fn(),
      updateQuery: jest.fn(),
      dispatch: jest.fn(),
      removeQuery: jest.fn(),
      store: store
    }

    const wrapper = shallow(
      <BlockTable.WrappedComponent {...props} />
    ).dive().dive().dive();

    expect(wrapper).toMatchSnapshot();
  });

  test('should render component with componentDidMount', () => {
    const props = {
      history: {},
      query: { last: 15 },
      queryResult: blocksMock,
      fetchBlockData: jest.fn(),
      executeQuery: jest.fn(),
      clearQuery: jest.fn(),
      updateQuery: jest.fn(),
      dispatch: jest.fn(),
      removeQuery: jest.fn(),
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

  test('should remove query on click', () => {
    const props = {
      history: {},
      query: { last: 15 },
      queryResult: blocksMock,
      fetchBlockData: jest.fn(),
      executeQuery: jest.fn(),
      clearQuery: jest.fn(),
      updateQuery: jest.fn(),
      dispatch: jest.fn(),
      removeQuery: jest.fn(),
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

  test('should refresh on button click', () => {
    const props = {
      history: {},
      query: { last: 15 },
      queryResult: blocksMock,
      fetchBlockData: jest.fn(),
      executeQuery: jest.fn(),
      clearQuery: jest.fn(),
      updateQuery: jest.fn(),
      dispatch: jest.fn(),
      removeQuery: jest.fn(),
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

  test('should view block detail on click', () => {
    const props = {
      history: {
        push: jest.fn()
      },
      query: { last: 15 },
      queryResult: blocksMock,
      fetchBlockData: jest.fn(),
      executeQuery: jest.fn(),
      clearQuery: jest.fn(),
      updateQuery: jest.fn(),
      dispatch: jest.fn(),
      removeQuery: jest.fn(),
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

  test('should invoke componentWillUnmount', () => {
    const props = {
      history: {},
      query: { last: 15 },
      queryResult: blocksMock,
      fetchBlockData: jest.fn(),
      executeQuery: jest.fn(),
      clearQuery: jest.fn(),
      updateQuery: jest.fn(),
      dispatch: jest.fn(),
      removeQuery: jest.fn(),
      store: store
    }

    const wrapper = shallow(
      <BlockTable.WrappedComponent {...props} />
    ).dive();

    wrapper.dive().dive().instance().componentWillUnmount();
    expect(props.clearQuery).toHaveBeenCalled();
    expect(props.clearQuery.mock.calls.length).toBe(1);
  });

  test('should invoke componentWillReceiveProps', () => {
    const props = {
      history: {},
      query: { last: 15 },
      queryResult: blocksMock,
      fetchBlockData: jest.fn(),
      executeQuery: jest.fn(),
      clearQuery: jest.fn(),
      updateQuery: jest.fn(),
      dispatch: jest.fn(),
      removeQuery: jest.fn(),
      store: store
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

  test('should test mapStateToProps function properly', () => {
    const state = {
      queryEngine: {
        query: { last: 15 },
        queryResult: blocksMock
      }
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});
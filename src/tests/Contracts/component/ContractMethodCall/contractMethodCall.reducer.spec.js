import reducer from '../../../../components/Contracts/components/ContractMethodCall/contractMethodCall.reducer';
import {
  METHOD_CALL_OPEN_MODAL,
  METHOD_CALL_CLOSE_MODAL,
  METHOD_CALL_FETCH_ARGS_SUCCESS,
  METHOD_CALL_FETCH_ARGS_FAILURE,
  METHOD_CALL_REQUEST,
  METHOD_CALL_SUCCESS,
  METHOD_CALL_FAILURE
} from '../../../../components/Contracts/components/ContractMethodCall/contractMethodCall.actions';

describe('Test contractMethodCall reducer', () => {

  const initialState = {
    modals: {
      methodCallgreet8070db2390462e2b5748085bde1350590e08bb17: {
        isOpen: true,
        result: 'Waiting for method to be called...'
      }
    }
  };

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // METHOD_CALL_OPEN_MODAL
  test('should update open modal', () => {
    const action = {
      key: "methodCallgreet8070db2390462e2b5748085bde1350590e08bb17",
      type: METHOD_CALL_OPEN_MODAL
    }

    expect(reducer({ modals: {} }, action)).toMatchSnapshot();
  });

  // METHOD_CALL_CLOSE_MODAL
  test('should update close modal', () => {
    const action = {
      key: "methodCallgreet8070db2390462e2b5748085bde1350590e08bb17",
      type: METHOD_CALL_CLOSE_MODAL
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // METHOD_CALL_FETCH_ARGS_SUCCESS
  test('should update args on success', () => {
    const action = {
      args: {},
      key: "methodCallgreet8070db2390462e2b5748085bde1350590e08bb17",
      type: METHOD_CALL_FETCH_ARGS_SUCCESS
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // METHOD_CALL_FETCH_ARGS_FAILURE
  test('should update args on success', () => {
    const action = {
      error: 'ERROR',
      key: "methodCallgreet8070db2390462e2b5748085bde1350590e08bb17",
      type: METHOD_CALL_FETCH_ARGS_FAILURE
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // METHOD_CALL_REQUEST
  test('should invoke method call request', () => {
    const action = {
      key: "methodCallgreet8070db2390462e2b5748085bde1350590e08bb17",
      type: METHOD_CALL_REQUEST
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // METHOD_CALL_SUCCESS
  test('should update result after METHOD_CALL_REQUEST success', () => {
    const action = {
      key: "methodCallgreet8070db2390462e2b5748085bde1350590e08bb17",
      result: {},
      type: METHOD_CALL_SUCCESS
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // METHOD_CALL_FAILURE
  test('should update result after METHOD_CALL_REQUEST failure', () => {
    const action = {
      key: "methodCallgreet8070db2390462e2b5748085bde1350590e08bb17",
      error: 'ERROR',
      type: METHOD_CALL_FAILURE
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

})

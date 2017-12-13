import reducer from '../../../../components/Contracts/components/ContractMethodCall/contractMethodCall.reducer';
import {
  methodCallOpenModal,
  methodCallCloseModal,
  methodCallFetchArgsFailure,
  methodCallFetchArgsSuccess,
  methodCall,
  methodCallSuccess,
  methodCallFailure
} from '../../../../components/Contracts/components/ContractMethodCall/contractMethodCall.actions';
import { modals, initialState } from './contractMethodCallMock';

describe('Test contractMethodCall reducer', () => {

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // METHOD_CALL_OPEN_MODAL
  test('should update open modal', () => {
    const action = methodCallOpenModal(modals.key);
    expect(reducer({ modals: {} }, action)).toMatchSnapshot();
  });

  // METHOD_CALL_CLOSE_MODAL
  test('should update close modal', () => {
    const action = methodCallCloseModal(modals.key);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // METHOD_CALL_FETCH_ARGS_SUCCESS
  test('should update args on success', () => {
    const action = methodCallFetchArgsSuccess(modals.key, modals.args);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // METHOD_CALL_FETCH_ARGS_FAILURE
  test('should update args on success', () => {
    const action = methodCallFetchArgsFailure(modals.key, modals.error);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // METHOD_CALL_REQUEST
  test('should invoke method call request', () => {
    const action = methodCall(modals.key, {});
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // METHOD_CALL_SUCCESS
  test('should update result after METHOD_CALL_REQUEST success', () => {
    const action = methodCallSuccess(modals.key, {});
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // METHOD_CALL_FAILURE
  test('should update result after METHOD_CALL_REQUEST failure', () => {
    const action = methodCallFailure(modals.key, modals.error);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

})

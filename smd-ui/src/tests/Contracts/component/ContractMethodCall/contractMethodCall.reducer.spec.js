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

describe('ContractMethodCall: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // METHOD_CALL_OPEN_MODAL
  test('update open modal', () => {
    const action = methodCallOpenModal(modals.key);
    expect(reducer({ modals: {} }, action)).toMatchSnapshot();
  });

  // METHOD_CALL_CLOSE_MODAL
  test('update close modal', () => {
    const action = methodCallCloseModal(modals.key);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  describe('update args', () => {

    // METHOD_CALL_FETCH_ARGS_SUCCESS
    test('on success', () => {
      const action = methodCallFetchArgsSuccess(modals.key, modals.args, modals.isPayable);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // METHOD_CALL_FETCH_ARGS_FAILURE
    test('on failure', () => {
      const action = methodCallFetchArgsFailure(modals.key, modals.error);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  })

  describe('method call', () => {

    // METHOD_CALL_REQUEST
    test('on request', () => {
      const action = methodCall(modals.key, {});
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // METHOD_CALL_SUCCESS
    test('on success', () => {
      const action = methodCallSuccess(modals.key, {});
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // METHOD_CALL_FAILURE
    test('on failure', () => {
      const action = methodCallFailure(modals.key, modals.error);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  })

})

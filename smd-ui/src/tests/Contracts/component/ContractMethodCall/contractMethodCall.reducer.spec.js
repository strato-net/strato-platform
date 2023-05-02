import reducer from '../../../../components/Contracts/components/ContractMethodCall/contractMethodCall.reducer';
import {
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

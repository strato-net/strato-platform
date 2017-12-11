import {
  methodCallOpenModal,
  METHOD_CALL_OPEN_MODAL,
  methodCallCloseModal,
  METHOD_CALL_CLOSE_MODAL,
  methodCallFetchArgs,
  METHOD_CALL_FETCH_ARGS_REQUEST,
  methodCallFetchArgsSuccess,
  METHOD_CALL_FETCH_ARGS_SUCCESS,
  methodCallFetchArgsFailure,
  METHOD_CALL_FETCH_ARGS_FAILURE,
  methodCall,
  METHOD_CALL_REQUEST,
  methodCallSuccess,
  METHOD_CALL_SUCCESS,
  methodCallFailure,
  METHOD_CALL_FAILURE
} from '../../../../components/Contracts/components/ContractMethodCall/contractMethodCall.actions';

describe('Test ContractMethodCall actions', () => {

  test('should open model on the basis of contract key', () => {
    const expectedAction = {
      type: METHOD_CALL_OPEN_MODAL,
      key: 'methodCallgreet8070db2390462e2b5748085bde1350590e08bb17'
    }
    expect(methodCallOpenModal(expectedAction.key)).toEqual(expectedAction)
  });

  test('should close model on the basis of contract key', () => {
    const expectedAction = {
      type: METHOD_CALL_CLOSE_MODAL,
      key: 'methodCallgreet8070db2390462e2b5748085bde1350590e08bb17'
    }
    expect(methodCallCloseModal(expectedAction.key)).toEqual(expectedAction)
  });

  test('should fetch arguments', () => {
    const expectedAction = {
      type: METHOD_CALL_FETCH_ARGS_REQUEST,
      name: 'Greeter',
      address: '8070db2390462e2b5748085bde1350590e08bb17',
      symbol: 'greet',
      key: 'methodCallgreet8070db2390462e2b5748085bde1350590e08bb17'
    }
    expect(methodCallFetchArgs(expectedAction.name, expectedAction.address, expectedAction.symbol, expectedAction.key)).toEqual(expectedAction)
  });

  test('should update arguments on METHOD_CALL_FETCH_ARGS_REQUEST', () => {
    const expectedAction = {
      type: METHOD_CALL_FETCH_ARGS_SUCCESS,
      key: 'methodCallgreet8070db2390462e2b5748085bde1350590e08bb17',
      args: {}
    }
    expect(methodCallFetchArgsSuccess(expectedAction.key, expectedAction.args)).toEqual(expectedAction)
  });

  test('should update with failure on METHOD_CALL_FETCH_ARGS_REQUEST', () => {
    const expectedAction = {
      type: METHOD_CALL_FETCH_ARGS_FAILURE,
      key: 'methodCallgreet8070db2390462e2b5748085bde1350590e08bb17',
      error: 'ERROR'
    }
    expect(methodCallFetchArgsFailure(expectedAction.key, expectedAction.error)).toEqual(expectedAction)
  });

  test('should call method to execute function or constructor', () => {
    const expectedAction = {
      type: METHOD_CALL_REQUEST,
      key: 'methodCallgreet8070db2390462e2b5748085bde1350590e08bb17',
      payload: {
        args: {},
        contractAddress: "8070db2390462e2b5748085bde1350590e08bb17",
        contractName: "Greeter",
        methodName: "greet",
        password: "pass",
        userAddress: "76a3192ce9aa0531fe7e0e3489a469018c0bff03",
        username: "tanuj"
      }
    }
    expect(methodCall(expectedAction.key, expectedAction.payload)).toEqual(expectedAction)
  });

  test('should return result on METHOD_CALL_REQUEST success', () => {
    const expectedAction = {
      type: METHOD_CALL_SUCCESS,
      key: 'methodCallgreet8070db2390462e2b5748085bde1350590e08bb17',
      result: {
        status: "Success",
        hash: "8f6fcd037e028f84ec2e9462c4e29444cd3456c8bc8705723f0c36d075c14c5d"
      }
    }
    expect(methodCallSuccess(expectedAction.key, expectedAction.result)).toEqual(expectedAction)
  });

  test('should return error on METHOD_CALL_REQUEST failure', () => {
    const expectedAction = {
      type: METHOD_CALL_FAILURE,
      key: 'methodCallgreet8070db2390462e2b5748085bde1350590e08bb17',
      result: 'ERROR'
    }
    expect(methodCallFailure(expectedAction.key, expectedAction.result)).toEqual(expectedAction)
  });
});
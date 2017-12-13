import {
  methodCallOpenModal,
  methodCallCloseModal,
  methodCallFetchArgs,
  methodCallFetchArgsSuccess,
  methodCallFetchArgsFailure,
  methodCall,
  methodCallSuccess,
  methodCallFailure
} from '../../../../components/Contracts/components/ContractMethodCall/contractMethodCall.actions';
import { modals } from './contractMethodCallMock';

describe('Test ContractMethodCall actions', () => {

  test('should open model on the basis of contract key', () => {
    expect(methodCallOpenModal(modals.key)).toMatchSnapshot();
  });

  test('should close model on the basis of contract key', () => {
    expect(methodCallCloseModal(modals.key)).toMatchSnapshot();
  });

  test('should fetch arguments', () => {
    expect(methodCallFetchArgs(modals.name, modals.address, modals.symbol, modals.key)).toMatchSnapshot();
  });

  test('should update arguments on METHOD_CALL_FETCH_ARGS_REQUEST', () => {
    expect(methodCallFetchArgsSuccess(modals.key, modals.args)).toMatchSnapshot();
  });

  test('should update with failure on METHOD_CALL_FETCH_ARGS_REQUEST', () => {
    expect(methodCallFetchArgsFailure(modals.key, modals.error)).toMatchSnapshot();
  });

  test('should call method to execute function or constructor', () => {
    expect(methodCall(modals.key, modals.payload)).toMatchSnapshot();
  });

  test('should return result on METHOD_CALL_REQUEST success', () => {
    expect(methodCallSuccess(modals.key, modals.result)).toMatchSnapshot();
  });

  test('should return error on METHOD_CALL_REQUEST failure', () => {
    const result = 'ERROR';
    expect(methodCallFailure(modals.key, result)).toMatchSnapshot();
  });

});
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

describe('ContractMethodCall: action', () => {

  test('open model with contract key', () => {
    expect(methodCallOpenModal(modals.key)).toMatchSnapshot();
  });

  test('close model with contract key', () => {
    expect(methodCallCloseModal(modals.key)).toMatchSnapshot();
  });

  describe('fetch arguments', () => {

    test('request', () => {
      expect(methodCallFetchArgs(modals.name, modals.address, modals.symbol, modals.key, modals.chainId)).toMatchSnapshot();
    });

    test('success', () => {
      expect(methodCallFetchArgsSuccess(modals.key, modals.args)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(methodCallFetchArgsFailure(modals.key, modals.error)).toMatchSnapshot();
    });

  })

  describe('method call', () => {

    test('request', () => {
      expect(methodCall(modals.key, modals.payload)).toMatchSnapshot();
    });

    test('success', () => {
      expect(methodCallSuccess(modals.key, modals.result)).toMatchSnapshot();
    });

    test('failure', () => {
      const result = 'ERROR';
      expect(methodCallFailure(modals.key, result)).toMatchSnapshot();
    });

  })

});
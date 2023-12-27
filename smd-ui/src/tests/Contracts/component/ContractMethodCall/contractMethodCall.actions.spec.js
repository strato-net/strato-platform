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
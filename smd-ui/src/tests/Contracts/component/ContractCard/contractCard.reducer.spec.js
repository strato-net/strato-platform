import reducer from '../../../../components/Contracts/components/ContractCard/contractCard.reducer';
import {
  fetchContractInfoRequest,
  fetchContractInfoSuccess,
  fetchContractInfoFailure
} from '../../../../components/Contracts/components/ContractCard/contractCard.actions';
import { modals, initialState } from './contractCardMock';

describe('ContractCard: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });


  describe('get contract info', () => {

    test('on success', () => {
      const action = fetchContractInfoSuccess(modals.key, {address: modals.address, chainId: modals.chainId, xabi: {}});
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    test('on failure', () => {
      const action = fetchContractInfoFailure(modals.key, modals.error);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  })

})

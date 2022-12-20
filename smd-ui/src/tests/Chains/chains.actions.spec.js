import {
  fetchChains,
  fetchChainsSuccess,
  fetchChainsFailure,
  fetchChainDetail,
  fetchChainDetailSuccess,
  fetchChainDetailFailure,
  fetchChainIds,
  fetchChainIdsSuccess,
  fetchChainIdsFailure,
  getLabelIds,
  selectChain,
  changeChainFilter,
  resetChainId,
  resetInitailLabel
} from "../../components/Chains/chains.actions";
import { chains, payload } from "./chainsMock";

describe('Chains: action', () => {

  describe('chain', () => {

    test('request', () => {
      expect(fetchChains(payload.limit, payload.offset)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchChainsSuccess(chains)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchChainsFailure('error')).toMatchSnapshot();
    });

  });

  describe('chain detail', () => {
    const data = {
      label: 'airline cartel 1',
      id: '64885c49cdc6fe5f15975596115a120ec1e9a616e88a22e0be0457f373d75b73',
      detail: chains[0]
    }

    test('request', () => {
      expect(fetchChainDetail(data.label, data.id)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchChainDetailSuccess(data.label, data.id, data.detail)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchChainDetailFailure(data.label, data.id, 'error')).toMatchSnapshot();
    });

  });

  describe('chain ids', () => {

    test('request', () => {
      expect(fetchChainIds()).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchChainIdsSuccess(chains)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchChainIdsFailure('error')).toMatchSnapshot();
    });

  });

  test('getLabelids', () => {
    expect(getLabelIds('airline cartel 1')).toMatchSnapshot();
  });

  test('select chain', () => {
    expect(selectChain('64885c49cdc6fe5f15975596115a120ec1e9a616e88a22e0be0457f373d75b73')).toMatchSnapshot();
  });

  test('filter chain', () => {
    expect(changeChainFilter('airline cartel 1')).toMatchSnapshot();
  });

  test('reset chain', () => {
    expect(resetChainId('airline cartel 1')).toMatchSnapshot();
  });

  test('reset initail label', () => {
    expect(resetInitailLabel()).toMatchSnapshot();
  });

});
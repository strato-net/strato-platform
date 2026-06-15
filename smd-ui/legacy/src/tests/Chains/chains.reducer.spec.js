import reducer from '../../components/Chains/chains.reducer';
import {
  fetchChains,
  fetchChainsFailure,
  fetchChainsSuccess,
  changeChainFilter,
  fetchChainDetailSuccess,
  fetchChainDetailFailure,
  resetChainId,
  resetInitailLabel,
  fetchChainIdsSuccess,
  fetchChainIdsFailure,
  getLabelIds,
  selectChain
} from '../../components/Chains/chains.actions';
import { chains, chain } from './chainsMock';

describe('Chains: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('fetch chain', () => {

    // FETCH_CHAINS_REQUEST
    test('request', () => {
      const action = fetchChains();
      const initialState = {
        chains: {},
        labelIds: {},
        filter: '',
        initialLabel: null,
        error: null,
        listChain: {},
        listLabelIds: {},
        chainIds: [],
        selectedChain: null,
        isLoading: true
      };

      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_CHAINS_SUCCESS
    test('success', () => {
      const action = fetchChainsSuccess(chains);
      const initialState = {
        chains: {},
        labelIds: {},
        filter: '',
        initialLabel: null,
        error: null,
        listChain: {},
        listLabelIds: {},
        chainIds: [],
        selectedChain: null,
        isLoading: false
      };

      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_CHAINS_IDS_FAILURE
    test('failure', () => {
      const initialState = {
        chains: {},
        labelIds: {},
        filter: '',
        initialLabel: null,
        error: null,
        listChain: {},
        listLabelIds: {},
        chainIds: [],
        selectedChain: null,
        isLoading: false
      };

      const action = fetchChainsFailure('error');
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

  // CHANGE_CHAIN_FILTER
  test('filter chain', () => {
    const initialState = {
      chains: chains,
      labelIds: {},
      filter: '',
      initialLabel: null,
      error: null,
      listChain: {},
      listLabelIds: {},
      chainIds: [],
      selectedChain: null
    };

    const action = changeChainFilter('airline cartel 1');
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  describe('fetch chain details', () => {
    const data = {
      label: 'airline cartel 1',
      id: '64885c49cdc6fe5f15975596115a120ec1e9a616e88a22e0be0457f373d75b73',
      detail: chains[0]
    }

    // FETCH_CHAIN_DETAIL_SUCCESS
    test('success', () => {
      const action = fetchChainDetailSuccess(data.label, data.id, data.detail);
      const initialState = {
        chains: chains,
        labelIds: {},
        filter: '',
        initialLabel: null,
        error: null,
        listChain: {},
        listLabelIds: {},
        chainIds: [],
        selectedChain: null
      };

      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_CHAIN_DETAIL_FAILURE
    test('failure', () => {
      const initialState = {
        chains: chains,
        labelIds: {},
        filter: '',
        initialLabel: null,
        error: null,
        listChain: {},
        listLabelIds: {},
        chainIds: [],
        selectedChain: null
      };

      const action = fetchChainDetailFailure(data.label, data.id, 'error');
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

  // RESET_CHAIN_ID
  test('reset chain ID', () => {
    const initialState = {
      chains: {
        "airline cartel 9": {
          "75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86": {
            members: []
          },
        }
      },
      labelIds: {},
      filter: '',
      initialLabel: null,
      error: null,
      listChain: {},
      listLabelIds: {},
      chainIds: [],
      selectedChain: null
    };

    const action = resetChainId('airline cartel 9');
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // RESET_INITIAL_LABLE
  test('reset initail label', () => {
    const initialState = {
      chains: {
        "airline cartel 9": {
          "75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86": {
            members: []
          },
        }
      },
      labelIds: {},
      filter: '',
      initialLabel: 'airline cartel 9',
      error: null,
      listChain: {},
      listLabelIds: {},
      chainIds: [],
      selectedChain: null
    };

    const action = resetInitailLabel();
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  describe('fetch chainIDs', () => {

    // FETCH_CHAINS_IDS_SUCCESS
    test('success', () => {
      const initialState = {
        chains: {},
        labelIds: {},
        filter: '',
        initialLabel: null,
        error: null,
        listChain: {},
        listLabelIds: {},
        chainIds: [],
        selectedChain: null
      };

      const action = fetchChainIdsSuccess(chains);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_CHAINS_IDS_FAILED
    test('failure', () => {
      const initialState = {
        chains: {},
        labelIds: {},
        filter: '',
        initialLabel: null,
        error: null,
        listChain: {},
        listLabelIds: {},
        chainIds: [],
        selectedChain: null
      };

      const action = fetchChainIdsFailure('error');
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

  // GET_LABEL_IDS
  test('get label Id', () => {
    const initialState = {
      chains: {},
      labelIds: {},
      filter: '',
      initialLabel: null,
      error: null,
      listChain: chain,
      listLabelIds: {},
      chainIds: [],
      selectedChain: null
    };

    const action = getLabelIds('airline cartel 9');
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // SELECT_CHAIN
  test('select chain', () => {
    const initialState = {
      chains: {},
      labelIds: {},
      filter: '',
      initialLabel: null,
      error: null,
      listChain: chain,
      listLabelIds: {},
      chainIds: [],
      selectedChain: null
    };

    const action = selectChain('75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86');
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

});
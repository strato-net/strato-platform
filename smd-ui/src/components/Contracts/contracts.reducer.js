import {
  FETCH_CONTRACTS,
  FETCH_CONTRACTS_SUCCESSFUL,
  FETCH_CONTRACTS_FAILED,
  FETCH_CONTRACTS_WITH_PREVIEW_SUCCESS,
  FETCH_CONTRACTS_WITH_PREVIEW_FAILED,
  LOAD_MORE_CONTRACTS_SUCCESS,
  LOAD_MORE_INSTANCES_SUCCESS,
  LOAD_MORE_INSTANCES_FAILED,
  CHANGE_CONTRACT_FILTER,
} from './contracts.actions';
import {
  FETCH_STATE_SUCCESS,
  FETCH_CIRRUS_INSTANCES_SUCCESS,
  SELECT_CONTRACT_INSTANCE,
  FETCH_ACCOUNT_SUCCESS
} from './components/ContractCard/contractCard.actions';

const initialState = {
  contracts: {},
  filter: '',
  error: null,
  isLoading: false,
  isLoadingContracts: false,
  contractsNext: null, // offset for next contracts page
  __next: {} // pagination metadata
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_CONTRACTS:
      return {
        contracts: state.contracts,
        filter: state.filter,
        error: null,
        isLoading: true
      };
    case FETCH_ACCOUNT_SUCCESS:
      let contracts = state.contracts;
      const contractArray = state.contracts[action.name].instances;
      contractArray.forEach((contract) => {
        if (action.address === contract.address) {
          contract['balance'] = action.account.length > 0 ? action.account[0].balance : "0";
        }
      })
      contracts[action.name].instances = contractArray;
      return {
        contracts,
        filter: state.filter,
        error: null
      };
    case FETCH_CONTRACTS_SUCCESSFUL:
      const contractNames1 = Object.getOwnPropertyNames(action.contracts);
      const updatedContracts1 = {};
      contractNames1.forEach((name) => {
          updatedContracts1[name] = {
            instances: action.contracts[name]
              .map((instance) => {
                return {
                  ...instance,
                  fromBloc: true
                }
              })
          };
      });
      return {
        contracts: updatedContracts1,
        filter: state.filter,
        error: state.error,
        isLoading: false
      };
    case FETCH_CONTRACTS_FAILED:
      return {
        contracts: state.contracts,
        filter: state.filter,
        error: action.error,
        isLoading: false
      };
    case CHANGE_CONTRACT_FILTER:
      return {
        contracts: state.contracts,
        filter: action.filter,
        error: state.error
      }
    
    // New pagination cases
    case FETCH_CONTRACTS_WITH_PREVIEW_SUCCESS:
      const contractNames2 = Object.getOwnPropertyNames(action.contracts);
      const updatedContracts2 = {};
      contractNames2.forEach((name) => {
        const instances = action.contracts[name] || [];
        const instancesNext = action.__next.instances && action.__next.instances[name];
        
        updatedContracts2[name] = {
          instances: instances.map((instance) => ({
            ...instance,
            fromBloc: true
          })),
          instancesNext: instancesNext,
          isLoadingInstances: false
        };
      });
      
      return {
        contracts: action.isInitialLoad ? updatedContracts2 : { ...state.contracts, ...updatedContracts2 },
        filter: state.filter,
        error: null,
        isLoading: false,
        isLoadingContracts: false,
        contractsNext: action.__next.contracts,
        __next: action.__next
      };
    
    case FETCH_CONTRACTS_WITH_PREVIEW_FAILED:
      return {
        contracts: state.contracts,
        filter: state.filter,
        error: action.error,
        isLoading: false,
        isLoadingContracts: false
      };
    
    case LOAD_MORE_CONTRACTS_SUCCESS:
      const moreContractNames = Object.getOwnPropertyNames(action.contracts);
      const moreUpdatedContracts = {};
      moreContractNames.forEach((name) => {
        const instances = action.contracts[name] || [];
        const instancesNext = action.__next.instances && action.__next.instances[name];
        
        moreUpdatedContracts[name] = {
          instances: instances.map((instance) => ({
            ...instance,
            fromBloc: true
          })),
          instancesNext: instancesNext,
          isLoadingInstances: false
        };
      });
      
      return {
        contracts: { ...state.contracts, ...moreUpdatedContracts },
        filter: state.filter,
        error: null,
        isLoadingContracts: false,
        contractsNext: action.__next.contracts,
        __next: action.__next
      };
    
    case LOAD_MORE_INSTANCES_SUCCESS:
      const existingContract = state.contracts[action.contractName];
      if (!existingContract) return state;
      
      const newInstances = action.instances.map((instance) => ({
        ...instance,
        fromBloc: true
      }));
      
      return {
        ...state,
        contracts: {
          ...state.contracts,
          [action.contractName]: {
            ...existingContract,
            instances: [...existingContract.instances, ...newInstances],
            instancesNext: action.nextOffset,
            isLoadingInstances: false
          }
        }
      };
    
    case LOAD_MORE_INSTANCES_FAILED:
      const failedContract = state.contracts[action.contractName];
      if (!failedContract) return state;
      
      return {
        ...state,
        contracts: {
          ...state.contracts,
          [action.contractName]: {
            ...failedContract,
            isLoadingInstances: false
          }
        },
        error: action.error
      };
    case FETCH_STATE_SUCCESS:
      const instances = state.contracts[action.name].instances
        .map(function (instance, i) {
          if (instance.address !== action.address) {
            return instance
          }
          return {
            ...instance,
            state: action.state
          }
        });

      return {
        contracts: {
          ...state.contracts,
          [action.name]: {
            instances: instances
          }
        },
        filter: state.filter,
        error: state.error
      }
    case FETCH_CIRRUS_INSTANCES_SUCCESS:
      const updatedInstances = state.contracts[action.name].instances.map((instance) => {
        return {
          ...instance,
          fromCirrus: action.instances.filter((i) => {
            return i.address === instance.address
          }).length === 1
        };
      });

      action.instances.forEach((instance) => {
        const exists = updatedInstances.filter((i) => {
          return i.address === instance.address
        }).length === 1;
        if (!exists) {
          updatedInstances.push({
            ...instance,
            fromCirrus: true
          });
        }
      });
      return {
        contracts: {
          ...state.contracts,
          [action.name]: {
            instances: updatedInstances
          }
        },
        filter: state.filter,
        error: state.error
      };
    case SELECT_CONTRACT_INSTANCE:
      const cInstances = state.contracts[action.name].instances
        .map(function (instance, i) {
          return {
            ...instance,
            selected: instance.address === action.address
          }
        });
      return {
        contracts: {
          ...state.contracts,
          [action.name]: {
            instances: cInstances
          }
        },
        filter: state.filter,
        error: state.error
      }

    default:
      return state;
  }
};

export default reducer;

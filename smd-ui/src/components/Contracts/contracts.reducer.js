import {
  FETCH_CONTRACTS,
  FETCH_CONTRACTS_SUCCESSFUL,
  FETCH_CONTRACTS_FAILED,
  CHANGE_CONTRACT_FILTER,
  FETCH_CONTRACT_INSTANCES,
  FETCH_CONTRACT_INSTANCES_SUCCESS,
  FETCH_CONTRACT_INSTANCES_FAILURE,
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
  pagination: {
    contractsNext: null,
    instancesNext: {} // contractName -> nextOffset
  }
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
      const contractNames = Object.getOwnPropertyNames(action.contracts);
      const updatedContracts = {};
      contractNames.forEach((name) => {
        // Skip __next metadata
        if (name !== '__next') {
          updatedContracts[name] = {
            instances: action.contracts[name]
              .map((instance) => {
                return {
                  ...instance,
                  fromBloc: true
                }
              })
          };
        }
      });
      
      // Extract pagination metadata
      const pagination = {
        contractsNext: action.contracts.__next?.contracts || null,
        instancesNext: action.contracts.__next?.instances || {}
      };
      
      return {
        contracts: updatedContracts,
        filter: state.filter,
        error: state.error,
        isLoading: false,
        pagination: pagination
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
    
    case FETCH_CONTRACT_INSTANCES_SUCCESS:
      // Append new instances to existing contract
      const existingInstances = state.contracts[action.contractName]?.instances || [];
      const newInstances = action.instances.map(instance => ({
        ...instance,
        fromBloc: true
      }));
      
      return {
        contracts: {
          ...state.contracts,
          [action.contractName]: {
            instances: [...existingInstances, ...newInstances]
          }
        },
        filter: state.filter,
        error: state.error,
        pagination: {
          ...state.pagination,
          instancesNext: {
            ...state.pagination.instancesNext,
            [action.contractName]: action.instances.length === 10 ? 
              (state.pagination.instancesNext[action.contractName] || 0) + 10 : null
          }
        }
      };
    
    case FETCH_CONTRACT_INSTANCES_FAILURE:
      return {
        ...state,
        error: action.error
      };

    default:
      return state;
  }
};

export default reducer;

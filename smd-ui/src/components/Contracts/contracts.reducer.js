import {
  FETCH_CONTRACTS,
  FETCH_CONTRACTS_SUCCESSFUL,
  FETCH_CONTRACTS_FAILED,
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
  isLoading: false
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
        if (state.contracts[name]) {
          // new instances
          const newInstances = action.contracts[name]
            .filter((instance) => {
              return state.contracts[name].instances
                .filter((i) => {
                  return i.address === instance.address
                }).length === 0;
            })
            .map((instance) => {
              return {
                ...instance,
                fromBloc: true
              }
            });
          updatedContracts[name] = {
            instances: state.contracts[name].instances.concat(newInstances)
          };
        }
        else {
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
      return {
        contracts: updatedContracts,
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

import {
  FETCH_CONTRACTS,
  FETCH_CONTRACTS_SUCCESS,
  FETCH_CONTRACTS_FAILURE,
  CHANGE_CONTRACT_FILTER,
} from './contracts.actions';
import {
  FETCH_STATE_SUCCESS,
  FETCH_CIRRUS_INSTANCES_SUCCESS,
  SELECT_CONTRACT_INSTANCE
} from './components/ContractCard/contractCard.actions';

const initialState = {
  contracts: {},
  filter: '',
  error: null,
};

const reducer = function (state = initialState, action) {
  switch (action.type) {
    case FETCH_CONTRACTS:
      return {
        contracts: state.contracts,
        filter: state.filter,
        error: null,
      };
    case FETCH_CONTRACTS_SUCCESS:
      const stateContracts = state.contracts;
      let received_contracts = Object.getOwnPropertyNames(action.contracts).reduce(function (result, contractName) {
        let newInstances = [];
        let indexed = false;
        if (stateContracts[contractName]) {
          newInstances = action.contracts[contractName].map((contract, i) => {
            const contractInStateInstances = stateContracts[contractName].instances;
            const contractInState = contractInStateInstances ? contractInStateInstances.filter((contractsInState) => {return contractsInState.address === contract.address && contractsInState.name === contract.name}) : undefined;
            if (contractInState && contractInState.length > 0 && contractInState[0].fromCirrus) {
              indexed = true;
              return contractInState[0]
            }
            else if (indexed){
                return {
                  ...contract,
                  fromBloc: true,
                  fromCirrus: true
                };
              }
            else {
              return {
                ...contract,
                fromBloc: true,
                fromCirrus: false
              }
            }
          });
          result[contractName] = {instances: newInstances};
          return result;
        }
        else {
          newInstances = action.contracts[contractName]
            .map((contract) => {
              return {
                ...contract,
                fromBloc: true
              }
          });
          result[contractName] = {instances: newInstances};
          return result;
        }
      }, {});
      return {
        contracts: received_contracts,
        filter: state.filter,
        error: state.error,
      };
    case FETCH_CONTRACTS_FAILURE:
      return {
        contracts: state.contracts,
        filter: state.filter,
        error: action.error
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
      const cirrusInstances = action.instances.map((instance) => {
        // if instance exists
        let i = 0;
        for (i; i < state.contracts[action.name].instances.length; i++) {
          if (state.contracts[action.name].instances[i].address === instance.address) {
            // break;
            return {
              ...instance,
              fromCirrus: true,
              fromBloc: true
            };
          }
        }

        //if(i === state.contracts[action.name].instances.length) {
        return {
          ...instance,
          fromCirrus: false,
          fromBloc: true
        };
        //}
      });

      return {
        contracts: {
          ...state.contracts,
          [action.name]: {
            instances: cirrusInstances
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

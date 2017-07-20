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
      let received_contracts = Object.getOwnPropertyNames(action.contracts).reduce(function(result, contractName) {
        const instances = action.contracts[contractName].map((contract) => {contract.fromBloc = true; return contract});
        result[contractName] = {instances: instances};
        return result;
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
        .map(function(instance, i){
          if(instance.address !== action.address) {
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
        for(i; i < state.contracts[action.name].instances.length; i++) {
          if(state.contracts[action.name].instances[i].address === instance.address) {
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
        .map(function(instance, i){
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

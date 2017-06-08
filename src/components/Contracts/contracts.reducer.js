import {
  FETCH_CONTRACTS,
  FETCH_CONTRACTS_SUCCESS,
  FETCH_CONTRACTS_FAILURE,
  CHANGE_CONTRACT_FILTER,
} from './contracts.actions';
import {
  FETCH_STATE_SUCCESS,
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
      console.log(FETCH_CONTRACTS);
      return {
        contracts: state.contracts,
        filter: state.filter,
        error: null,
      };
    case FETCH_CONTRACTS_SUCCESS:
      let received_contracts = Object.getOwnPropertyNames(action.contracts).reduce(function(result, contractName) {
        result[contractName] = {instances: action.contracts[contractName]};
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

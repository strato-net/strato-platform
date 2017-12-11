import {
  fetchState,
  FETCH_STATE_REQUEST,
  fetchStateSuccess,
  FETCH_STATE_SUCCESS,
  fetchStateFailure,
  FETCH_STATE_FAILURE,
  selectContractInstance,
  SELECT_CONTRACT_INSTANCE,
  fetchCirrusInstances,
  FETCH_CIRRUS_INSTANCES_REQUEST,
  fetchCirrusInstancesSuccess,
  FETCH_CIRRUS_INSTANCES_SUCCESS,
  fetchCirrusInstancesFailure,
  FETCH_CIRRUS_INSTANCES_FAILURE,
  fetchAccount,
  FETCH_ACCOUNT_REQUEST,
  fetchAccountSuccess,
  FETCH_ACCOUNT_SUCCESS,
  fetchAccountFailure,
  FETCH_ACCOUNT_FAILURE
} from '../../../../components/Contracts/components/ContractCard/contractCard.actions';

describe('Test ContractCard actions', () => {

  test('should create an action to fetch state', () => {
    const expectedAction = {
      type: FETCH_STATE_REQUEST,
      name: 'Greeter',
      address: '0293f9b10a4453667db7fcfe74728c9d821add4b'
    }
    expect(fetchState(expectedAction.name, expectedAction.address)).toEqual(expectedAction)
  });

  test('should return state after FETCH_STATE_REQUEST success', () => {
    const expectedAction = {
      type: FETCH_STATE_SUCCESS,
      name: 'Greeter',
      address: '0293f9b10a4453667db7fcfe74728c9d821add4b',
      state: { dna: '', geneticallyModify: 'function() {}', name: '' }
    }
    expect(fetchStateSuccess(expectedAction.name, expectedAction.address, expectedAction.state)).toEqual(expectedAction)
  });

  test('should return error after FETCH_STATE_REQUEST failure', () => {
    const expectedAction = {
      type: FETCH_STATE_FAILURE,
      error: 'ERROR'
    }
    expect(fetchStateFailure(expectedAction.error)).toEqual(expectedAction)
  });

  test('select contract instance', () => {
    const expectedAction = {
      type: SELECT_CONTRACT_INSTANCE,
      name: 'Greeter',
      address: '0293f9b10a4453667db7fcfe74728c9d821add4b'
    }
    expect(selectContractInstance(expectedAction.name, expectedAction.address)).toEqual(expectedAction)
  });

  test('should create an action to fetch instance', () => {
    const expectedAction = {
      type: FETCH_CIRRUS_INSTANCES_REQUEST,
      name: 'Greeter'
    }
    expect(fetchCirrusInstances(expectedAction.name)).toEqual(expectedAction)
  });

  test('should return instance after FETCH_CIRRUS_INSTANCES_REQUEST success', () => {
    const expectedAction = {
      type: FETCH_CIRRUS_INSTANCES_SUCCESS,
      name: 'Greeter',
      instances: [
        {
          address: "b7b986bf23faebd8d745c65fa42a8c2f0fc2ebb9",
          greeting: ""
        }]
    }
    expect(fetchCirrusInstancesSuccess(expectedAction.name, expectedAction.instances)).toEqual(expectedAction)
  });

  test('should return error after FETCH_CIRRUS_INSTANCES_REQUEST with failure', () => {
    const expectedAction = {
      type: FETCH_CIRRUS_INSTANCES_FAILURE,
      name: 'Greeter',
      error: 'ERROR'
    }
    expect(fetchCirrusInstancesFailure(expectedAction.name, expectedAction.error)).toEqual(expectedAction)
  });

  test('should create an action to fetch account', () => {
    const expectedAction = {
      type: FETCH_ACCOUNT_REQUEST,
      name: 'Greeter',
      address: '0293f9b10a4453667db7fcfe74728c9d821add4b'
    }
    expect(fetchAccount(expectedAction.name, expectedAction.address)).toEqual(expectedAction)
  });

  test('should return account after FETCH_ACCOUNT_REQUEST success', () => {
    const expectedAction = {
      type: FETCH_ACCOUNT_SUCCESS,
      name: 'Greeter',
      address: '0293f9b10a4453667db7fcfe74728c9d821add4b',
      account: [{ "contractRoot": "1578e5fa942f475f407b9f9c67c4474bd4856a5f1935ee3fb7ffe4333018f1d7", "nonce": 0 }]
    }
    expect(fetchAccountSuccess(expectedAction.name, expectedAction.address, expectedAction.account)).toEqual(expectedAction)
  });

  test('should return error after FETCH_ACCOUNT_REQUEST failure', () => {
    const expectedAction = {
      type: FETCH_ACCOUNT_FAILURE,
      name: 'Greeter',
      address: '0293f9b10a4453667db7fcfe74728c9d821add4b',
      error: 'ERROR'
    }
    expect(fetchAccountFailure(expectedAction.name, expectedAction.address, expectedAction.error)).toEqual(expectedAction)
  });

});
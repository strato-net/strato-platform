import reducer from '../../components/CreateContract/createContract.reducer';
import {
  contractFormChange,
  contractNameChange,
  usernameChange,
  contractOpenModal,
  contractCloseModal,
  createContract,
  createContractSuccess,
  createContractFailure,
  updateToast,
  compileContract,
  compileContractSuccess,
  compileContractFailure,
  resetError,
  CONTRACT_CLOSE_MODAL
} from '../../components/CreateContract/createContract.actions';
import { payload, createContractResponse, payloadCompile, payloadCompileSearchable, compileError, compileResponse } from './createContractMock';

describe('CreateContract: reducer', () => {

  let initialState

  beforeEach(() => {
    initialState = {
      isOpen: false,
      contractCompileErrors: undefined,
      abi: undefined,
      response: "Status: Upload Contract",
      username: '',
      contract: '',
      contractName: undefined,
      createDisabled: true,
      filename: undefined,
      toster: false,
      toastsMessage: '',
      error: "",
    };
  })

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  test('contract open modal', () => {
    const action = contractOpenModal();
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('contract close modal', () => {
    const action = contractCloseModal();
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('username change', () => {
    const action = usernameChange(payload.username)
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  test('contract name change', () => {
    const action = contractNameChange(payload.contract)
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  test('contract source change', () => {
    const action = contractFormChange(payload.fileText)
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  test('update toast', () => {
    const action = updateToast(createContractResponse)
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  test('reset error', () => {
    const action = resetError();
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  describe('create contract', () => {

    test('on request', () => {
      const action = createContract(payload);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    test('on success', () => {
      const action = createContractSuccess(createContractResponse);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    test('on success without status', () => {
      const action = createContractSuccess({});
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    test('on failure', () => {
      const action = createContractFailure('error');
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  })

  describe('compile contract', () => {

    test('on request', () => {
      const action = compileContract(payloadCompile.name, payloadCompile.contract, payloadCompile.searchable);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    test('on success', () => {
      const action = compileContractSuccess(compileResponse);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    test('on failure', () => {
      const action = compileContractFailure(compileError);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  })

});
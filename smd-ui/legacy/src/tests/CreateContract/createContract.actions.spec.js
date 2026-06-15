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
  resetError
} from '../../components/CreateContract/createContract.actions';
import { payload, createContractResponse, payloadCompile, payloadCompileSearchable, compileError, compileResponse } from './createContractMock';

describe('CreateContract: action', () => {

  test('contract form change', () => {
    expect(contractFormChange(payload.fileText)).toMatchSnapshot();
  });

  test('contract name change', () => {
    expect(contractNameChange(payload.contract)).toMatchSnapshot();
  });

  test('user name change', () => {
    expect(usernameChange(payload.username)).toMatchSnapshot();
  });

  test('contract open model', () => {
    expect(contractOpenModal()).toMatchSnapshot();
  });

  test('contract close model', () => {
    expect(contractCloseModal()).toMatchSnapshot();
  });

  test('update toast', () => {
    expect(updateToast(createContractResponse)).toMatchSnapshot();
  });

  test('reset error', () => {
    expect(resetError()).toMatchSnapshot();
  });

  describe('create contract', () => {

    test('request', () => {
      expect(createContract(payload)).toMatchSnapshot();
    });

    test('success', () => {
      expect(createContractSuccess(createContractResponse)).toMatchSnapshot();
    });

    test('without status', () => {
      expect(createContractSuccess({})).toMatchSnapshot();
    });

    test('failure', () => {
      expect(createContractFailure('error')).toMatchSnapshot();
    });

  })

  describe('compile contract', () => {

    test('request', () => {
      expect(compileContract(payloadCompile.name, payloadCompile.contract, payloadCompile.solidvm)).toMatchSnapshot();
    });

    test('success', () => {
      expect(compileContractSuccess(compileResponse)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(compileContractFailure(compileError)).toMatchSnapshot();
    });

  })

});
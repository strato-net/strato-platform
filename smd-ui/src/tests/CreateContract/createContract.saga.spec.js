import watchCreateContract, {
  watchCompileContract,
  createContract,
  compileContract,
  createContractApiCall,
  compileContractApiCall,
  compileChainContract
} from '../../components/CreateContract/createContract.saga';
import {
  takeLatest,
  call,
  put
} from 'redux-saga/effects';
import {
  COMPILE_CONTRACT_REQUEST,
  COMPILE_CONTRACT_SUCCESS,
  COMPILE_CONTRACT_FAILURE,
  CREATE_CONTRACT_REQUEST,
  CREATE_CONTRACT_SUCCESS,
  CREATE_CONTRACT_FAILURE,
  compileContractSuccess,
  compileContractFailure,
  createContractSuccess,
  createContractFailure,
  updateToast
} from '../../components/CreateContract/createContract.actions';
import {
  fetchContracts
} from '../../components/Contracts/contracts.actions';
import { fetchCirrusInstances } from '../../components/Contracts/components/ContractCard/contractCard.actions'
import { expectSaga } from 'redux-saga-test-plan';
import { payload, createContractResponse, payloadCompile, payloadCompileSearchable, compileResponse, compileError, responseError } from './createContractMock';
import { stopSubmit } from 'redux-form'
import { COMPILE_CHAIN_CONTRACT_REQUEST, compileChainContractSuccess, compileChainContractFailure } from '../../components/CreateChain/createChain.actions';
var fs = require('fs');

describe('CreateContract: saga', () => {

  test('watch create contract', () => {
    const gen = watchCreateContract();
    expect(gen.next().value).toEqual(takeLatest(CREATE_CONTRACT_REQUEST, createContract));
    expect(gen.next().done).toBe(true);
  })

  test('watch compile contract', () => {
    const gen = watchCompileContract();
    expect(gen.next().value).toEqual(takeLatest(COMPILE_CONTRACT_REQUEST, compileContract));
    expect(gen.next().value).toEqual(takeLatest(COMPILE_CHAIN_CONTRACT_REQUEST, compileChainContract));
    expect(gen.next().done).toBe(true);
  })

  describe('createContract generator', () => {

    test('create request inspection', () => {
      const gen = createContract({ type: CREATE_CONTRACT_REQUEST, payload });
      expect(gen.next().value).toEqual(call(createContractApiCall, payload.contract, payload.fileText, payload.username, payload.address, payload.password, payload.arguments, payload.chainId, payload.metadata, payload.useWallet));
      expect(gen.next([createContractResponse]).value).toEqual(put(createContractSuccess(createContractResponse)));
      expect(gen.next().value).toEqual(put(updateToast()));
      expect(gen.next().value).toEqual(put(fetchContracts(payload.chainId, 10, 0)));
      expect(gen.next().value).toEqual(put(fetchCirrusInstances('GreeterC', payload.chainId)));
      expect(gen.throw().value).toEqual(put(createContractFailure()))
      expect(gen.next().done).toBe(true);
    })

    test('compile contract request inspection', () => {
      const gen = compileContract({ type: COMPILE_CONTRACT_REQUEST, name: payloadCompile.name, contract: payloadCompile.contract, searchable: payloadCompile.searchable });
      expect(gen.next().value).toEqual(call(compileContractApiCall, payloadCompile.name, payloadCompile.contract, payloadCompile.searchable));
      expect(gen.next(compileResponse).value).toEqual(put(compileContractSuccess(compileResponse)));
      expect(gen.throw().value).toEqual(put(compileContractFailure()))
      expect(gen.next().value).toEqual(put(stopSubmit('create-contract', { contract: 'undefined' })))
      expect(gen.next().done).toBe(true);
    })

    test('compile chain contract request inspection', () => {
      const gen = compileChainContract({ type: COMPILE_CHAIN_CONTRACT_REQUEST, name: payloadCompile.name, contract: payloadCompile.contract, searchable: payloadCompile.searchable });
      expect(gen.next().value).toEqual(call(compileContractApiCall, payloadCompile.name, payloadCompile.contract, payloadCompile.searchable));
      expect(gen.next(compileResponse).value).toEqual(put(compileChainContractSuccess(compileResponse)));
      expect(gen.throw().value).toEqual(put(compileChainContractFailure()));
      expect(gen.next().done).toBe(true);
    })

    describe('create Contract', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(createContractResponse));
        expectSaga(createContract, { payload: payload })
          .call.fn(createContractApiCall, payload.contract, payload.fileText, payload.username, payload.address, payload.password, payload.chainId, payload.arguments).put.like({ action: { type: CREATE_CONTRACT_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify('error'));
        expectSaga(createContract, { payload: payload })
          .call.fn(createContractApiCall, payload.contract, payload.fileText, payload.username, payload.address, payload.password, payload.arguments).put.like({ action: { type: CREATE_CONTRACT_FAILURE } })
          .run().then((result) => { done() });
      });

    })

    describe('compile Contract', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(compileResponse));
        expectSaga(compileContract, payloadCompile)
          .call.fn(compileContractApiCall, payloadCompile.name, payloadCompile.contract, payloadCompile.searchable).put.like({ action: { type: COMPILE_CONTRACT_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('compile searchable success', (done) => {
        fetch.mockResponse(JSON.stringify(compileResponse));
        expectSaga(compileContract, payloadCompileSearchable)
          .call.fn(compileContractApiCall, payloadCompileSearchable.name, payloadCompileSearchable.contract, payloadCompileSearchable.searchable).put.like({ action: { type: COMPILE_CONTRACT_SUCCESS } })
          .run().then((result) => { done() });
      });

      test.skip('failure', (done) => {
        fetch.mockReject(JSON.stringify(compileError));
        expectSaga(compileContract, payloadCompile)
          .call.fn(compileContractApiCall, payloadCompile.name, payloadCompile.contract, payloadCompile.searchable).put.like({action: { type: COMPILE_CONTRACT_FAILURE }})
          .run().then((result) => { done() });
      });

    })

  });

})


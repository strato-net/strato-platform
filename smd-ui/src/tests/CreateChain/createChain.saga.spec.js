import {
  takeLatest,
  call,
  put
} from 'redux-saga/effects';
import watchCreateChain, {
  createChain,
  createChainApiCall
} from '../../components/CreateChain/createChain.saga';
import {
  createChainSuccess, createChainFailure, CREATE_CHAIN_REQUEST, CREATE_CHAIN_SUCCESS, CREATE_CHAIN_FAILURE
} from '../../components/CreateChain/createChain.actions';
import { mockResponse } from './createChainMock';
import { delay } from 'redux-saga';
import { fetchChains, fetchChainIds } from '../../components/Chains/chains.actions';
import { expectSaga } from 'redux-saga-test-plan';

describe('CreateChain: saga', () => {

  test('watch create chain', () => {
    const gen = watchCreateChain();
    expect(gen.next().value).toEqual(takeLatest(CREATE_CHAIN_REQUEST, createChain));
    expect(gen.next().done).toBe(true);
  })

  describe('createChain generator', () => {

    const payload = {
      label: 'airline cartel 9',
      members: [{ "orgName": "BlockApps", "orgUnit": "Engineering" }],
      balances: [{ balance: 500000000000000, address: "f11b5c42f5b84efa07f6b0a32c3fc545ff509126" }],
      integrations: {},
      src: `contract SimpleStorage {
        uint public storedData;
      }`,
      contractName: 'SimpleStorage',
      args: { addRule: "MajorityRules", removeRule: "MajorityRules" },
      vm: false,
    }

    describe('inspection', () => {

      test('Without Error (status 200)', () => {
        const gen = createChain({ type: CREATE_CHAIN_REQUEST, ...payload });
        expect(gen.next().value).toEqual(call(createChainApiCall, payload.label, payload.members, payload.balances, payload.integrations, payload.src, payload.args, payload.vm, payload.contractName));
        expect(gen.next({ status: 200, mockResponse }).value).toEqual(put(createChainSuccess({ status: 200, mockResponse })));
        expect(gen.next().value).toEqual(call(delay, 2000));
        expect(gen.next().value).toEqual(put(fetchChains()));
        expect(gen.next().value).toEqual(put(fetchChainIds()));
        expect(gen.throw('error').value).toEqual(put(createChainFailure('error')));
        expect(gen.next().done).toBe(true);
      });

      test('With Error (status 500)', () => {
        const gen = createChain({ type: CREATE_CHAIN_REQUEST, ...payload });
        expect(gen.next().value).toEqual(call(createChainApiCall, payload.label, payload.members, payload.balances, payload.integrations, payload.src, payload.args, payload.vm, payload.contractName));
        expect(gen.next('error').value).toEqual(put(createChainFailure('error')));
        expect(gen.throw('error').value).toEqual(put(createChainFailure('error')));
        expect(gen.next().done).toBe(true);
      });

    })

    describe('create chain', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(mockResponse));
        expectSaga(createChain, payload)
          .call.fn(createChainApiCall).put.like({ action: { type: CREATE_CHAIN_SUCCESS } })
          .run({ silenceTimeout: true }).then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject('error');
        expectSaga(createChain, payload)
          .call.fn(createChainApiCall).put.like({ action: { type: CREATE_CHAIN_FAILURE } })
          .run().then((result) => { done() });
      });

    })

  });

})


import {
  takeLatest,
  call,
  put
} from 'redux-saga/effects';
import watchDeployDapp, {
  deployDapp,
  deployDappApiCall
} from '../../components/DeployDapp/deployDapp.saga';
import {
  deployDappSuccess, deployDappFailure, DEPLOY_DAPP_REQUEST, DEPLOY_DAPP_SUCCESS, DEPLOY_DAPP_FAILURE
} from '../../components/DeployDapp/deployDapp.actions';
import { mockResponse } from './deployDappMock';
import { delay } from 'redux-saga';
import { fetchChains, fetchChainIds } from '../../components/Chains/chains.actions';
import { expectSaga } from 'redux-saga-test-plan';

describe('DeployDapp: saga', () => {

  test('watch create chain', () => {
    const gen = watchDeployDapp();
    expect(gen.next().value).toEqual(takeLatest(DEPLOY_DAPP_REQUEST, deployDapp));
    expect(gen.next().done).toBe(true);
  })

  describe('deployDapp generator', () => {

    const payload = {
      label: 'airline cartel 9',
      members: [{ "orgName": "BlockApps", "orgUnit": "Engineering" }],
      balances: [{ balance: 500000000000000, address: "f11b5c42f5b84efa07f6b0a32c3fc545ff509126" }],
      integrations: {},
      src: `contract SimpleStorage {
        uint public storedData;
      }`,
      contract: 'SimpleStorage',
      args: { addRule: "MajorityRules", removeRule: "MajorityRules" },
      vm: false,
    }

    describe('inspection', () => {

      test('Without Error (status 200)', () => {
        const gen = deployDapp({ type: DEPLOY_DAPP_REQUEST, ...payload });
        expect(gen.next().value).toEqual(call(deployDappApiCall, payload.label, payload.members, payload.balances, payload.integrations, payload.src, payload.contract, payload.args, payload.vm));
        expect(gen.next({ status: 200, mockResponse }).value).toEqual(put(deployDappSuccess({ status: 200, mockResponse })));
        expect(gen.next().value).toEqual(call(delay, 2000));
        expect(gen.next().value).toEqual(put(fetchChains()));
        expect(gen.next().value).toEqual(put(fetchChainIds()));
        expect(gen.throw('error').value).toEqual(put(deployDappFailure('error')));
        expect(gen.next().done).toBe(true);
      });

      test('With Error (status 500)', () => {
        const gen = deployDapp({ type: DEPLOY_DAPP_REQUEST, ...payload });
        expect(gen.next().value).toEqual(call(deployDappApiCall, payload.label, payload.members, payload.balances, payload.integrations, payload.src, payload.contract, payload.args, payload.vm));
        expect(gen.next('error').value).toEqual(put(deployDappFailure('error')));
        expect(gen.throw('error').value).toEqual(put(deployDappFailure('error')));
        expect(gen.next().done).toBe(true);
      });

    })

    describe('deploy dapp', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(mockResponse));
        expectSaga(deployDapp, payload)
          .call.fn(deployDappApiCall).put.like({ action: { type: DEPLOY_DAPP_SUCCESS } })
          .run({ silenceTimeout: true }).then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject('error');
        expectSaga(deployDapp, payload)
          .call.fn(deployDappApiCall).put.like({ action: { type: DEPLOY_DAPP_FAILURE } })
          .run().then((result) => { done() });
      });

    })

  });

})


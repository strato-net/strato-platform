import { takeLatest, put, call } from 'redux-saga/effects';
import {
  DEPLOY_DAPP_REQUEST,
  deployDappSuccess,
  deployDappFailure,
} from './deployDapp.actions';
import { delay } from "redux-saga"
import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';
import {
  fetchChains,
  fetchChainIds
} from '../Chains/chains.actions';

const url = env.BLOC_URL + "/chain"

export function deployDappApiCall(label, members, balances, integrations, src, contract, args, vm) {
  return fetch(
    url,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        "args": args,
        "balances": balances,
        "members": members,
        "parentChains": integrations,
        "src": src,
        "contract": contract,
        "label": label,
        "metadata": {
          VM: vm ? 'SolidVM' : 'EVM' 
        }
      })
    }
  )
    .then(handleErrors)
    .then(function (response) {
      if (response.status !== 200) {
        return response.text().then(error => {
          throw error
        })
      }
      return response;
    })
    .catch(function (error) {
      throw error;
    });
}

export function* deployDapp(action) {
  try {
    let response = yield call(deployDappApiCall, action.label, action.members, action.balances, action.integrations, action.src, action.contract, action.args, action.vm);
    // TODO: Change when when we start getting actual error messages
    if (response.status === 200) {
      yield put(deployDappSuccess(response));
      yield call(delay, 2000);
      yield put(fetchChains());
      yield put(fetchChainIds())
    } else {
      yield put(deployDappFailure(response));
    }
  }
  catch (err) {
    yield put(deployDappFailure(err));
  }
}

export default function* watchDeployDapp() {
  yield takeLatest(DEPLOY_DAPP_REQUEST, deployDapp);
}
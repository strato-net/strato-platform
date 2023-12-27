import { takeLatest, put, call } from 'redux-saga/effects';
import {
  CREATE_CONTRACT_REQUEST,
  createContractSuccess,
  createContractFailure,
  COMPILE_CONTRACT_REQUEST,
  compileContractSuccess,
  compileContractFailure,
  updateToast
} from './createContract.actions';
import { fetchContracts } from '../Contracts/contracts.actions';
import { stopSubmit } from 'redux-form'
import { CREATE_CONTRACT_FORM } from './'
import { fetchCirrusInstances } from '../Contracts/components/ContractCard/contractCard.actions'
import { env } from '../../env';
import { COMPILE_CHAIN_CONTRACT_REQUEST, compileChainContractSuccess, compileChainContractFailure } from '../CreateChain/createChain.actions';
import { handleErrors } from '../../lib/handleErrors';
import { isOauthEnabled } from '../../lib/checkMode';
import { createUrl } from '../../lib/url';

const getXabiUrl = env.BLOC_URL + "/contracts/xabi";
const blocCompileUrl = env.BLOC_URL + "/contracts/compile";

export function createContractApiCall(contract, src, username, address, password, args, chainid, metadata, useWallet) {
  const isOauth = isOauthEnabled();
  const options = isOauth ? { query: { resolve: true, chainid, use_wallet: useWallet } } : { params: { username, address }, query: { resolve: true, chainid } };
  const prefix = isOauth ? env.STRATO_URL_V23 : env.BLOC_URL;
  const url = prefix + createUrl(isOauth ? "/transaction" : "/users/::username/::address/contract", options);

  const blocBody = { contract, value: 0, password, src, args, metadata };
  const oauthBody = {
    "txs": [
      {
        "payload": {
          contract,
          src,
          args,
          metadata
        },
        "type": "CONTRACT"
      }
    ]
  }

  const body = isOauthEnabled() ? oauthBody : blocBody;
  return fetch(
    url,
    {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    .then(handleErrors)
    .then(function (response) {
      if (response.status !== 200) {
        return response.text().then(error => {
          return error;
        })
      }
      return response.json();
    })
    .then(json => {
      return new Promise((resolve, reject) => {
        if (json.status === "Failure") {
          reject(json.txResult.message)
        }
        resolve(json)
      })
    })
    .catch(function (error) {
      throw error;
    });
}

export function compileContractApiCall(contractName, source, solidvm) {
  fetch(blocCompileUrl, {
    method: 'POST',
    credentials: "include",
    headers: {
      "accept": "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify([
      {
        "contractName": contractName,
        "source": source,
        "vm": solidvm ? "SolidVM" : "EVM",
      }
    ])
  })
    .then(handleErrors)
    .then(function (res) {
      if (res.ok) {
        return res.json();
      } else {
        return res.text().then(function (value) {
          throw value;
        });
      }
    }).catch(function (error) {
      throw error;
    });

  return fetch(getXabiUrl, {
    method: 'POST',
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "src=" + encodeURIComponent(source)
  })
    .then(handleErrors)
    .then(function (res) {
      if (res.ok) {
        return res.json();
      } else {
        return res.text().then(function (value) {
          throw value;
        });
      }
    }).catch(function (error) {
      throw error;
    });
}

export function* createContract(action) {
  try {
    let response = yield call( createContractApiCall
                             , action.payload.contract
                             , action.payload.fileText
                             , action.payload.username
                             , action.payload.address
                             , action.payload.password
                             , action.payload.arguments
                             , action.payload.chainId
                             , action.payload.metadata
                             , action.payload.useWallet);
    if (typeof response === "string") {
      yield put(createContractFailure(response));
    } else {
      yield put(createContractSuccess(response[0] || response));
      yield put(updateToast());
      yield put(fetchContracts(action.payload.chainId, 10, 0));
      yield put(fetchCirrusInstances(action.payload.contract, action.payload.chainId));
    }
  } catch (err) {
    yield put(createContractFailure(err));
  }
}

export function* compileContract(action) {
  try {
    let response = yield call(compileContractApiCall, action.name, action.contract, action.solidvm);
    yield put(compileContractSuccess(response));
  } catch (err) {
    yield put(compileContractFailure(err));
    yield put(stopSubmit(CREATE_CONTRACT_FORM, { contract: String(err) }))
  }
}

export function* compileChainContract(action) {
  try {
    let response = yield call(compileContractApiCall, action.name, action.contract, action.vm);
    yield put(compileChainContractSuccess(response));
  } catch (err) {
    yield put(compileChainContractFailure(err));
  }
}

export function* watchCompileContract() {
  yield takeLatest(COMPILE_CONTRACT_REQUEST, compileContract);
  yield takeLatest(COMPILE_CHAIN_CONTRACT_REQUEST, compileChainContract);
}

export default function* watchCreateContract() {
  yield takeLatest(CREATE_CONTRACT_REQUEST, createContract);
}

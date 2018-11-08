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

const url = env.BLOC_URL + "/users/:user/:address/contract?resolve&:chainid"
const compileUrl = env.BLOC_URL + "/contracts/xabi";
const blocCompileUrl = env.BLOC_URL + "/contracts/compile";

export function createContractApiCall(contract, src, username, address, password, args, chainId) {
  const contractUrl = url.replace(":user", username).replace(":address", address);
  return fetch(
    chainId ? contractUrl.replace(":chainid", `chainid=${chainId}`) : contractUrl.replace("&:chainid", ''), {
      method: 'POST',
      credentials: "include",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ contract, value: 0, password, src, args })
    }).then(function (response) {
      return response.json();
    }).catch(function (error) {
      throw error;
    });
}

export function compileContractApiCall(contractName, source, s) {
  const searchable = [contractName];
  if (s) {
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
          "searchable": searchable
        }
      ])
    }).then(function (res) {
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

  return fetch(compileUrl, {
    method: 'POST',
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "src=" + encodeURIComponent(source)
  }).then(function (res) {
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
    let response = yield call(createContractApiCall, action.payload.contract, action.payload.fileText, action.payload.username, action.payload.address, action.payload.password, action.payload.arguments, action.payload.chainId);
    yield put(createContractSuccess(response));
    yield put(updateToast());
    yield put(fetchContracts());
    yield put(fetchCirrusInstances(action.payload.contract));
  } catch (err) {
    yield put(createContractFailure(err));
  }
}

export function* compileContract(action) {
  try {
    let response = yield call(compileContractApiCall, action.name, action.contract, action.searchable);
    yield put(compileContractSuccess(response));
  } catch (err) {
    yield put(compileContractFailure(err));
    yield put(stopSubmit(CREATE_CONTRACT_FORM, { contract: String(err) }))
  }
}

export function* compileChainContract(action) {
  try {
    let response = yield call(compileContractApiCall, action.name, action.contract, action.searchable);
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

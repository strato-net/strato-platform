import {
    takeLatest,
    put,
    call
} from 'redux-saga/effects';

import {
    GET_HEALTH_REQUEST,
    GET_METADATA_REQUEST,
    fetchHealthSuccess,
    fetchHealthFailure,
    fetchMetadataSuccess,
    fetchMetadataFailure,
} from "./app.actions"
import { handleErrors } from '../lib/handleErrors';
import { env } from '../env';

const metadataUrl = env.STRATO_URL + '/metadata'

export function getHealthApi() {
  
  return fetch(
    env.HEALTH_URL,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(handleErrors)
    .then(function (response) {
      return response.json()
    })
    .catch(function (error) {
      throw error;
    })
}

export function getMetadataApi() {

  const cirrusUrl = env.CIRRUS_URL + "/Certificate?userAddress=eq.";
  
  return fetch(
    metadataUrl,
    {
      method: 'GET',
      credentials: "include",
      headers: {
        'Accept': 'application/json'
      },
    })
    .then(handleErrors)
    .then( async function (response) {
      const metadata = await response.json()
      const url = cirrusUrl + metadata.nodeAddress
      const nodeInfoRaw = await fetch (
          url,
          {
              method: 'GET',
              credentials: "include",
              headers: {
              'Accept': 'application/json'
              },
          }
      )
      const responseJson = await nodeInfoRaw.json()
      return {metadata, nodeInfo: responseJson[0]}
    })
    .catch(function (error) {
      throw error;
    })
}

export function* getHealth(action) {
    try {
      const response = yield call(getHealthApi);
      yield put(fetchHealthSuccess(response));
    }
    catch (err) {
      yield put(fetchHealthFailure(err));
    }
}

export function* getMetadata(action) {
    try {
      const response = yield call(getMetadataApi);
      yield put(fetchMetadataSuccess(response));
    }
    catch (err) {
      yield put(fetchMetadataFailure(err));
    }
}


export default function* watchGetHealth() {
    yield [
      takeLatest(GET_HEALTH_REQUEST, getHealth),
      takeLatest(GET_METADATA_REQUEST, getMetadata),
    ]
}
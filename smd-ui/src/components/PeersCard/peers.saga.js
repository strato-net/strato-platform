import { takeLatest, put, call } from 'redux-saga/effects';
import {
  GET_PEER_IDENTITY_REQUEST,
    getPeerIdentitySuccess,
    getPeerIdentityFailure
} from './peers.actions';
import { env } from '../../env';
import { handleErrors } from '../../lib/handleErrors';
// import * as createKeccakHash from 'keccak'

// createKeccakHash('keccak256').digest()

export function getPeersIdentityCall(peers) {
  
    const cirrusUrl = env.CIRRUS_URL + "/Certificate?userAddress=in.(";
    const addresses = [];
    // for (let i = 0; i < peers.length; i++) {
    //     const { pubkey } = peers[i];
    //     const keyHash = createKeccakHash('keccak256').update(pubkey).digest()
    //     const address = keyHash.slice(-20).toString('hex')
    //     addresses.push(address)
    // }
    // const url = cirrusUrl + addresses.join(",") + ")"
    // return fetch (
    //     url,
    //     {
    //         method: 'GET',
    //         credentials: "include",
    //         headers: {
    //         'Accept': 'application/json'
    //         },
    //     }
    // )
    // .then(handleErrors)
    // .then(function (response) {
    //     return response.json();
    // })
    // .catch(function (error) {
    //     throw error;
    // })
}

export function* getPeerIdentity(action) {
  try {
    let response = yield call(getPeersIdentityCall, action.data);
    yield put(getPeerIdentitySuccess(response));
  } catch (err) {
    yield put(getPeerIdentityFailure(err));
  }
}

export default function* watchGetPeerIdentity() {
//   yield takeLatest(GET_PEER_IDENTITY_REQUEST, getPeerIdentity);
}

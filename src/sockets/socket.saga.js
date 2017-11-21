import io from 'socket.io-client';
import {
	takeLatest,
	put,
	call,
	take,
	fork,
	takeEvery
} from 'redux-saga/effects';
import { eventChannel } from 'redux-saga';
import { SOCKET_SUBSCRIBE_ROOM, SOCKET_UNSUBSCRIBE_ROOM } from './socket.actions';
import {
	LAST_BLOCK_NUMBER,
	USERS_COUNT,
	CONTRACTS_COUNT
} from './rooms';
import {
	updateBlockNumber, 
	updatePreloadBlockNumber,
	updateContractCount,
	updatePreloadContractCount,
	updateUsersCount,
	updatePreloadUsersCount
} from '../components/Dashboard/dashboard.action';

// TODO: move this to ENV
const socket = io('ws://localhost:3001');

function registerActions(eventChannelEmit, room, preloadAction, eventAction) {
	socket.on(`PRELOAD_${room}`, data => {
		eventChannelEmit(preloadAction(data));
	})

	socket.on(`EVENT_${room}`, data => {
		eventChannelEmit(eventAction(data));
	})
}

function subscribe() {
	return eventChannel(emit => {
		registerActions(emit, LAST_BLOCK_NUMBER, updatePreloadBlockNumber, updateBlockNumber)
		registerActions(emit, USERS_COUNT, updatePreloadUsersCount, updateUsersCount)
		registerActions(emit, CONTRACTS_COUNT, updatePreloadContractCount, updateContractCount)
		socket.on('disconnect', e => {
			// TODO: handle
		});
		return () => { };
	});
}

function* readSocketEvents() {
	const channel = yield call(subscribe);
	while (true) {
		let action = yield take(channel);
		yield put(action);
	}
}

function* socketSubscribeUnsubscribeRoom(action) {
	socket.emit(action.name, '')
}

export function* watchCommunicateOverSocket() {
	yield takeEvery(SOCKET_SUBSCRIBE_ROOM, socketSubscribeUnsubscribeRoom);
	yield takeEvery(SOCKET_UNSUBSCRIBE_ROOM, socketSubscribeUnsubscribeRoom);
	yield fork(readSocketEvents)
}



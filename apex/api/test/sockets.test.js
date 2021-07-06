// /* jshint esnext: true */
// const chai = require('chai');
// const assert = chai.assert;
// const {
// 	LAST_BLOCK_NUMBER,
// 	TRANSACTIONS_COUNT,
// 	USERS_COUNT,
// 	GET_PEERS,
// 	CONTRACTS_COUNT,
// 	TRANSACTIONS_TYPE,
// 	GET_TRANSACTIONS,
// 	BLOCKS_PROPAGATION,
// 	BLOCKS_DIFFICULTY,
// 	GET_COINBASE,
// 	GET_HEALTH,
// 	GET_NODE_UPTIME,
// 	GET_SYSTEM_INFO
//   } = require('./rooms');
// const io_client = require("socket.io-client"); //socket for mock client
// const _server = require("socket.io"); //socket for serving data
// const {emitter, ON_SOCKET_PUBLISH_EVENTS } = require('./eventBroker');
// const { initial } = require('underscore');


// /**
//  * Things to test for:
//  * 	server initializes and broadcasts on a given port
//  * 	server broadcasts a message when it receives a ON_SOCKET_PUBLISH_EVENTS
//  * 	server subscribes/unsubscribes rooms when it receives the given message
//  * 	server broadcasts all respective data to the correct given room
//  * 		LAST_BLOCK_NUMBER
// 		TRANSACTIONS_COUNT
// 		USERS_COUNT
// 		GET_PEERS
// 		CONTRACTS_COUNT
// 		TRANSACTIONS_TYPE
// 		GET_TRANSACTIONS
// 		BLOCKS_PROPAGATION
// 		BLOCKS_DIFFICULTY
// 		GET_COINBASE
// 		GET_HEALTH
// 		GET_NODE_UPTIME
// 		GET_SYSTEM_INFO
// 	socket listener listens to same port as server
// 	socket listener receives correct data from each room
// 	socket listener subscribes/unsubscribes itself from rooms
//   	TODO:
// 	  create mock server that mimics same functionality as true server but uses fake data (not from db)
// 	  	use init(socket), and registerRoomAllocation from "sockets/init.js" as a blueprint for mock server except callbacks for each room should be custom callbacks as defined in this test file
//   	create mock listener to assert data that is received
//  *  */

// // modelled after emitters for each data type found in sockets/aggregators
// const dataEmitter = (room_name) => {
// 	return (data) => {
// 		emitter.emit(ON_SOCKET_PUBLISH_EVENTS, room_name, data)
// 	}
// }
// // modelled after socket emitters for each data type in sockets/aggregators
// const dataPreloader = (room_name) => {
// 	return (socket, initial_value) => {
// 		console.log(`Sent initial data for ${room_name}: ${initial_value.toString()}`);
// 		socket.emit(`PRELOAD_${room_name}`, initial_value);
// 	}
// }
// const contractsCountPreloader = dataPreloader(CONTRACTS_COUNT);
// const contractsCountEmitter = dataEmitter(CONTRACTS_COUNT);
// const blockNumberPreloader = dataPreloader(LAST_BLOCK_NUMBER);
// const blockNumberEmitter = dataEmitter(LAST_BLOCK_NUMBER);
// const blockDifficultyPreloader = dataPreloader(BLOCKS_DIFFICULTY);
// const blockDifficultyEmitter = dataEmitter(BLOCKS_DIFFICULTY);
// const transactionCountPreloader = dataPreloader(TRANSACTIONS_COUNT);
// const transactionCountEmitter = dataEmitter(TRANSACTIONS_COUNT);
// const blockPropagationPreloader = dataPreloader(BLOCKS_PROPAGATION);
// const blockPropagationEmitter = dataEmitter(BLOCKS_PROPAGATION);
// const coinbasePreloader = dataPreloader(GET_COINBASE);
// const peersPreloader = dataPreloader(GET_PEERS);
// const peersEmitter = dataEmitter(GET_PEERS);
// const healthStatusPreloader = dataPreloader(GET_HEALTH);
// const healthStatusEmitter = dataEmitter(GET_HEALTH); 
// const nodeUptimePreloader = dataPreloader(GET_NODE_UPTIME)
// const nodeUptimeEmitter = dataEmitter(GET_NODE_UPTIME);
// const systemInfoPreloader = dataPreloader(GET_SYSTEM_INFO)
// const systemInfoEmitter = dataEmitter(GET_SYSTEM_INFO);
// const transactionPreloader = dataPreloader(GET_TRANSACTIONS);
// const transactionsEmitter = dataEmitter(GET_TRANSACTIONS);
// const transactionTypePreloader = dataPreloader(TRANSACTIONS_TYPE)
// const getTransactionsTypeEmitter = dataEmitter(TRANSACTIONS_TYPE);
// const usersCountPreloader = dataPreloader(USERS_COUNT);
// const usersCountEmitter = dataEmitter(USERS_COUNT);
	  
// //copied from init.js
// function registerRoomAllocation(socket, room, preloadCb, cb_data) {
// 	socket.on(`SUBSCRIBE/${room}`, (data) => {
// 		socket.join(`ROOM_${room}`, () => {
// 			preloadCb(socket, cb_data)
// 		})
// 	})
// 	socket.on(`UNSUBSCRIBE/${room}`, (data) => {
// 		socket.leave(`ROOM_${room}`)
// 	})
// }
// function initMockServer(socket, initialData) {
// 	const rooms = [
// 		{ name : CONTRACTS_COUNT, preloader : contractsCountPreloader},
// 		{ name : LAST_BLOCK_NUMBER, preloader : blockNumberPreloader},
// 		{ name : BLOCKS_DIFFICULTY, preloader : blockDifficultyPreloader},
// 		{ name : TRANSACTIONS_COUNT, preloader : transactionCountPreloader},
// 		{ name : BLOCKS_PROPAGATION, preloader : blockPropagationPreloader},
// 		{ name : GET_COINBASE, preloader : coinbasePreloader},
// 		{ name : GET_PEERS, preloader : peersPreloader},
// 		{ name : GET_HEALTH, preloader : healthStatusPreloader},
// 		{ name : GET_NODE_UPTIME, preloader : nodeUptimePreloader},
// 		{ name : GET_SYSTEM_INFO, preloader : systemInfoPreloader},
// 		{ name : GET_TRANSACTIONS, preloader : transactionPreloader},
// 		{ name : TRANSACTIONS_TYPE, preloader : transactionTypePreloader},
// 		{ name : USERS_COUNT, preloader : usersCountPreloader}
// 	]
// 	// subscribe each room to listen for a subscription event and call preloader when that happens
// 	rooms.forEach(room => {
// 		registerRoomAllocation(socket, room.name, room.preloader, initialData[room.name]);
// 	}
// }
// function subscribeClientToEvents(socket) {
// 	const rooms = [
// 		{ name : CONTRACTS_COUNT, preloader : contractsCountPreloader},
// 		{ name : LAST_BLOCK_NUMBER, preloader : blockNumberPreloader},
// 		{ name : BLOCKS_DIFFICULTY, preloader : blockDifficultyPreloader},
// 		{ name : TRANSACTIONS_COUNT, preloader : transactionCountPreloader},
// 		{ name : BLOCKS_PROPAGATION, preloader : blockPropagationPreloader},
// 		{ name : GET_COINBASE, preloader : coinbasePreloader},
// 		{ name : GET_PEERS, preloader : peersPreloader},
// 		{ name : GET_HEALTH, preloader : healthStatusPreloader},
// 		{ name : GET_NODE_UPTIME, preloader : nodeUptimePreloader},
// 		{ name : GET_SYSTEM_INFO, preloader : systemInfoPreloader},
// 		{ name : GET_TRANSACTIONS, preloader : transactionPreloader},
// 		{ name : TRANSACTIONS_TYPE, preloader : transactionTypePreloader},
// 		{ name : USERS_COUNT, preloader : usersCountPreloader}
// 	]
// 	rooms.forEach(room => {
// 		socket.on(`PRELOAD_${room.name}`, data => {
// 			console.log("Got preload data: ", data);
// 		})
// 		socket.on(`EVENT_${room.name}`, data => {
// 			console.log("Got event data: ", data);
// 		})
// 	}
// }
// // Testing blueprint/boilerplate:
// describe("socket", () => {
// 	const initialData = {
// 		CONTRACTS_COUNT : 37,
// 		LAST_BLOCK_NUMBER : "3",
// 		BLOCKS_DIFFICULTY : [{x: 0, y: 10}, {x : 1, y: 26}],
// 		TRANSACTIONS_COUNT : [{x : 0, y : 1.5}, {x : 0, y : 1.2}],
// 		BLOCKS_PROPAGATION : [{x: 0, y : 11}, {x: 1, y : 3}],
// 		GET_COINBASE : "Ethereum",
// 		GET_PEERS : [{id : 123, pubkey : "pubkey123"}, {id : 456, pubkey : "pubkey456"}],
// 		GET_HEALTH : true,
// 		GET_NODE_UPTIME : 12345.67,
// 		GET_SYSTEM_INFO : "",
// 		GET_TRANSACTIONS : [{id : 123, timestamp : new Date("01-01-1970")}, {id : 456, timestamp : new Date("01-01-1971")}],
// 		TRANSACTIONS_TYPE : [{val : 1, type : "FunctionCall"}, {val : 2, type : "Transfer"}, {val : 3, type "Contract"}, {val : 4, type : "PrivateTX"}],
// 		USERS_COUNT : 1
// 	}
// 	let mockClient;
// 	let mockServer;
// 	// setup ws client before tests 
// 	before((done) => {
// 		// init ws server to serve messages
// 		mockServer = io_server.listen("9000");
// 		mockClient = io_client.connect('http://localhost:9000', {
// 			'reconnection delay' : 0,
// 			'reopen delay' : 0,
// 			'force new connection' : true,
// 			transports : ['websocket']
// 		});
// 		// use node event emitter to listen for socket events and broadcast them to the respective room
// 		mockServer.on('connect', socket => {
// 			emitter.on(ON_SOCKET_PUBLISH_EVENTS, function (room, data) {
// 				mockServer.in(`ROOM_${room}`).emit(`EVENT_${room}`, data);
// 			});
// 			//set up rooms to listen for subscriptions to rooms on this socket
// 			initMockRooms(socket, initialData);
// 		})
// 		mockClient.on("connect", socket => {
// 			//setup client to listen for PRELOAD, and EVENT messages
// 			subscribeClientToEvents(socket);
// 			done(); //indicates to mocha that server is done setting up 
// 		});
// 	});
// 	// destroy websockets after tests
// 	after((done) => {
// 		if (mockClient.connected) {
// 			mockClient.disconnect();
// 		}
// 		mockServer.close();
// 		done();
// 	})
// 	it("should emit an action", () => {
// 		mockClient.emit("SUBSCRIBE/USERS_COUNT");
// 	})
// })
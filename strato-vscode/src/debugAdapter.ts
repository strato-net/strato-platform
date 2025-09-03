import { StratoDebugSession } from './stratoDebug';

import * as Net from 'net';

/*
 * debugAdapter.js is the entrypoint of the debug adapter when it runs as a separate process.
 */

// first parse command line arguments to see whether the debug adapter should run as a server
let port = 0;
let filepath = '';
const args = process.argv.slice(2);
args.forEach(function (val, index, array) {
	const portMatch = /^--server=(\d{4,5})$/.exec(val);
	if (portMatch) {
		port = parseInt(portMatch[1], 10);
	}
	const fileMatch = /^--file=(.*)$/.exec(val);
	if (fileMatch) {
		filepath = fileMatch[1];
	}
});

if (port > 0) {

	// start a server that creates a new session for every connection request
	console.error(`waiting for debug protocol on port ${port}`);
	Net.createServer((socket) => {
		console.error('>> accepted connection from client');
		socket.on('end', () => {
			console.error('>> client connection closed\n');
		});
		const session = new StratoDebugSession(filepath);
		session.setRunAsServer(true);
		session.start(socket, socket);
	}).listen(port);
} else {

	// start a single session that communicates via stdin/stdout
	const session = new StratoDebugSession(filepath);
	process.on('SIGTERM', () => {
		session.shutdown();
	});
	session.start(process.stdin, process.stdout);
}

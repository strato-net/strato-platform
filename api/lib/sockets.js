var socketio = require('socket.io')
var bloc = require('../controllers/bloc')
var contract = require('../controllers/contract')
var user = require('../controllers/user')
var peers = require('../controllers/peers')

var sockets = {};

sockets.init = function (server) {
    // socket.io setup
    var io = socketio.listen(server);
    io.sockets.on('connection', function (socket) {
        console.log('socket connected', socket.id);
        // other logic
        socket.on('action', (action) => {
            switch (action.type) {
                case 'SOCKET_SUBSCRIBE/BLOC_COUNT':
                    bloc.subscribeBlocCount(socket)
                    break;
                case 'SOCKET_SUBSCRIBE/CONTRACTS_COUNT':
                    contract.subscribeContractCount(socket)
                    break;
                case 'SOCKET_SUBSCRIBE/USERS_COUNT':
                    user.subscribeUsersCount(socket)
                    break;
                case 'SOCKET_SUBSCRIBE/PEERS_COUNT':
                    peers.subscribePeersCount(socket)
                    break;
                default:
                    break;
            }
        });
    });
}

module.exports = sockets;
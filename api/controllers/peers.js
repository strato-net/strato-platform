function subscribePeersCount(socket) {
    setInterval(() => {
        var randomNumber = Math.floor(Math.random() * 100) ;        
        socket.emit('action', { type: 'SOCKET_PUBLISH_PEERS_COUNT', data: randomNumber });
    }, 3000);
}

module.exports = {
    subscribePeersCount: subscribePeersCount,
};
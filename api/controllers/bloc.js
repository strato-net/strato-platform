function subscribeBlocCount(socket) {
    setInterval(() => {
        var randomNumber = Math.floor(Math.random() * 100) ;                
        socket.emit('action', { type: 'SOCKET_PUBLISH_BLOC_COUNT', data: randomNumber });
    }, 3000);
}

module.exports = {
    subscribeBlocCount: subscribeBlocCount,
};
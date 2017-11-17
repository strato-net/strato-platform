function subscribeUsersCount(socket) {
    setInterval(() => {
        var randomNumber = Math.floor(Math.random() * 100) ;        
        socket.emit('action', { type: 'SOCKET_PUBLISH_USERS_COUNT', data: randomNumber });
    }, 3000);
}

module.exports = {
    subscribeUsersCount: subscribeUsersCount,
};
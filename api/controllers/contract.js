function subscribeContractCount(socket) {
    setInterval(() => {
        var randomNumber = Math.floor(Math.random() * 100) ;        
        socket.emit('action', { type: 'SOCKET_PUBLISH_CONTRACT_COUNT', data: randomNumber });
    }, 3000);
}

module.exports = {
    subscribeContractCount: subscribeContractCount,
};
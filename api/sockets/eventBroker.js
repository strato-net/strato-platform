const emitter = new (require('events').EventEmitter);
const ON_SOCKET_PUBLISH_EVENTS = "ON_SOCKET_PUBLISH_EVENTS"
module.exports = {
  emitter,
  ON_SOCKET_PUBLISH_EVENTS
}
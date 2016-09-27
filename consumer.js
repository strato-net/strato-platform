var Promise = require("bluebird");

var kafka = require('kafka-node');
var client = new kafka.Client();

var topic = "statediff_6cc9901a55bde87363a1e2051a8add380a045e10";

var offsets = Promise.promisifyAll(new kafka.Offset(client));
var offset = offsets.fetchLatestOffsetsAsync([topic]).get(topic).get(0);

var consumer = offset.then(function(offset) {
  return new kafka.Consumer(
    client,
    [{
      topic: topic, 
      offset: offset,
      partition: 0
    }],
    {fromOffset: true}
  );
});

consumer.call('on', 'message', function (m) {
    console.log(m.value);
})
consumer.call('on', 'error', function (err) {})

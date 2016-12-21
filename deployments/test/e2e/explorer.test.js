const ba = require('blockapps-rest');
const config = ba.common.config;
const api = ba.api(config);

describe('Explorere - check links', function() {

  const urls = ['/', '/this', '/that'];
  this.timeout(urls.length * 2 * 1000);

  urls.forEach(function(url) {
    it('url: ' + url, function(done) {
      api.explorer.get(url)
        .then(function(result) {
          done();
        }).catch(done);
    });
  });
});

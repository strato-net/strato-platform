var http = require('http');
var Pool = require('pg-pool')

// by default the pool will use the same environment variables
// as psql, pg_dump, pg_restore etc:
// https://www.postgresql.org/docs/9.5/static/libpq-envars.html

// you can optionally supply other values
var config = {
  host: 'localhost',
  user: 'kejace',
  //password: 'bar',
  database: 'cirrus',
};

process.on('unhandledRejection', function(e) {
  console.log(e.message, e.stack)
})

// create the pool somewhere globally so its lifetime
// lasts for as long as your app is running
var pool = new Pool(config)

var server = http.createServer(function(req, res) {

  var onError = function(err) {
    console.log(err.message, err.stack)
    res.writeHead(500, {'content-type': 'text/plain'});
    res.end('An error occurred');
  };

  pool.query('INSERT INTO visit (date) VALUES ($1)', [new Date()], function(err) {
    if (err) return onError(err);

    // get the total number of visits today (including the current visit)
    pool.query('SELECT COUNT(date) AS count FROM visit', function(err, result) {
      // handle an error from the query
      if(err) return onError(err);
      res.writeHead(200, {'content-type': 'text/plain'});
      res.end('You are visitor number ' + result.rows[0].count);
    });
  });
});

pool
  .query('CREATE TABLE IF NOT EXISTS visit (date timestamptz)')
  .then(function() {
    server.listen(3001, function() {
      console.log('server is listening on 3001')
    })
  })
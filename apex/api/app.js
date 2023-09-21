var express = require('express');
var path = require('path');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
const cors = require('cors');
const appConfig = require('./config/app.config');
var index = require('./routes/index');
const { attachMetricsEndpoint } = require('./lib/promClient');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));

app.use(logger('dev', { stream: process.stdout }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb', parameterLimit: 50000 }));
app.use(bodyParser.json());
app.use(cookieParser());


if (process.env.NODE_ENV !== 'production') {
  const corsOptions = {
    origin: function (origin, callback) {
      if (!origin) {
        callback(null, '*');
      }
      else if (appConfig.domainWhiteList.indexOf(origin) !== -1) {
        callback(null, true)
      }
      else {
        callback(new Error('Not allowed by CORS'))
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
    allowedHeader: ['Origin', 'Accept', 'Content-Type', 'X-Requested-With'],
    credentials: true
  };
  app.use(cors(corsOptions));
}

app.use(express.static(path.join(__dirname, 'public')));

attachMetricsEndpoint({ app });
app.use('/', index);
// app.use('/users', users);


// catch 404 and forward to error handler
app.use(function (req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  return next(err);
});

// error handler
app.use(function (err, req, res, next) {

  res.status(err.status || 500);

  if (res.statusCode === 500) {
    console.error(err, err.stack);
    err.message = "unexpected server error occurred"
  }

  let errorRespObj = {
    error: {
      message: err.message,
      status: res.status,
    },
  };
  // Including error stack when not in production
  const env = req.app.get('env');
  if (env === 'development' || env === 'test') {
    errorRespObj.error.stack = err.stack
  }

  res.json(errorRespObj);
});

module.exports = app;

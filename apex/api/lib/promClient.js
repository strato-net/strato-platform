const { getContentType, getSummary, Prometheus, createMiddleware } = require('@promster/express');

function attachMetricsEndpoint({ app }) {
  app.use(createMiddleware({ app }));

  app.use('/metrics', (req, res) => {
    req.statusCode = 200
    res.setHeader('Content-Type', getContentType())
    res.end(getSummary())
  })
}

module.exports = {
  attachMetricsEndpoint, Prometheus
}


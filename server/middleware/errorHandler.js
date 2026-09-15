/**
 * Global Express error handler. Attached last in index.js.
 */
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  // A 4xx is an expected, handled outcome - log it as one line. Only a 5xx is
  // an actual fault worth a stack trace.
  if (status >= 500) {
    console.error(err);
  } else {
    console.warn(`${status} ${req.method} ${req.originalUrl} - ${err.message}`);
  }

  res.status(status).json({ error: err.message || 'Internal server error' });
}

module.exports = errorHandler;

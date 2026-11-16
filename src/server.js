const app = require('./app');
const config = require('./config');

const server = app.listen(config.port, () => {
  console.log(`[SERVER_RUNNING] Smart Job Platform API listening on port ${config.port}`);
  console.log(`[ENV] Mode: ${config.nodeEnv}`);
  console.log(`[CONFIG] Public Ad Number: ${config.publicAdContactNumber}`);
  console.log(`[CONFIG] Admin Phone: ${config.adminPhone}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

module.exports = server;

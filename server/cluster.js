/**
 * Run the app with one worker per CPU core (cluster mode).
 * Use: npm start  or  node server/cluster.js
 */
require('dotenv').config();
const cluster = require('cluster');
const os = require('os');

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid}: spawning ${numCPUs} workers`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} exited (${code || signal}). Restarting.`);
    cluster.fork();
  });
} else {
  require('./index').start();
}

console.log('Sample background app started. PID:', process.pid);

let counter = 0;
const interval = setInterval(() => {
  counter++;
  console.log(`[sample-app] Heartbeat #${counter} at ${new Date().toISOString()}`);
  if (counter >= 100) {
    clearInterval(interval);
  }
}, 500);

process.on('SIGTERM', () => {
  console.log('Sample background app received SIGTERM. Exiting gracefully.');
  clearInterval(interval);
  process.exit(0);
});

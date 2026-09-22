import { runDueScheduledDeployments } from './db.js';

export function startDeploymentScheduler({ db, logger = console, intervalMs = 30_000 }) {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    try { runDueScheduledDeployments(db, { logger }); } finally { running = false; }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

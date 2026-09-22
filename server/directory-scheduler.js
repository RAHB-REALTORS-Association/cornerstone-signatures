import { audit } from './db.js';
import { getDirectorySettings, syncDirectoryUsers } from './entra.js';
import { getManageSettings, recordScheduledSync } from './manage-settings.js';

export async function runScheduledDirectorySync({ db, directoryProvider, now = Date.now(), logger = console }) {
  const settings = getManageSettings(db);
  const schedule = settings.directorySchedule;
  if (!directoryProvider || !schedule.enabled) return { ran: false, reason: !directoryProvider ? 'not_configured' : 'disabled' };
  const last = schedule.lastRunAt ? Date.parse(schedule.lastRunAt) : 0;
  if (last && now - last < schedule.intervalHours * 60 * 60 * 1000) return { ran: false, reason: 'not_due' };
  try {
    const filters = getDirectorySettings(db).filters;
    const users = await directoryProvider(filters);
    const result = syncDirectoryUsers(db, users, filters, 'system', settings.directoryDefaults);
    recordScheduledSync(db, { ok: true, ...result }, 'system');
    return { ran: true, result };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    recordScheduledSync(db, { ok: false, message }, 'system');
    audit(db, 'system', 'directory.sync_failed', 'directory', 'entra', { message });
    logger.error?.('Scheduled Entra sync failed', error);
    return { ran: true, error };
  }
}

export function startDirectorySyncScheduler(options) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runScheduledDirectorySync(options); } finally { running = false; }
  };
  void tick();
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

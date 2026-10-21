// Which Google Drive folders, files and calendars the server will touch for a signed-in user. Without this any user could
// name any folder or file the service account can see (with the full-Drive scope: the whole Drive) and move or trash it.
// Allowed: the configured parent folder, the folders recorded on cases, files recorded on documents, and whatever this
// server itself created a moment ago (before the device has saved the new ids into the case).
import { HttpError } from './http.js';
import { getStore } from './db/index.js';

const MAX_REMEMBERED = 5000;
const createdFolders = new Set();
const createdFiles = new Set();

function remember(set, id) {
  if (!id) return;
  set.add(id);
  if (set.size > MAX_REMEMBERED) set.delete(set.values().next().value);
}
export const rememberFolder = (id) => remember(createdFolders, id);
export const rememberFile = (id) => remember(createdFiles, id);
export const resetDriveGuard = () => {
  createdFolders.clear();
  createdFiles.clear();
};

const denied = (what) => new HttpError(403, 'drive_target_not_allowed', `${what} לא משויך למערכת, ולכן השרת לא ייגע בו`);

async function realStore(cfg) {
  return cfg.db.mode === 'off' ? null : await getStore(cfg);
}

function folderSet(cfg, store) {
  const ids = new Set([cfg.google.driveParentId, ...createdFolders].filter(Boolean));
  for (const k of store.list('cases')) {
    if (k.driveFolderId) ids.add(k.driveFolderId);
    for (const v of Object.values(k.driveFolders ?? {})) if (typeof v === 'string') ids.add(v);
  }
  return ids;
}

/** Throws unless `id` is a folder the system knows. Servers without a database (token mode) skip the check. */
export async function assertFolder(cfg, id) {
  const store = await realStore(cfg);
  if (!store) return;
  if (!folderSet(cfg, store).has(String(id))) throw denied('התיקייה');
}

/** Throws unless `id` is a file or folder the system knows. */
export async function assertFileOrFolder(cfg, id) {
  const store = await realStore(cfg);
  if (!store) return;
  if (folderSet(cfg, store).has(String(id)) || createdFiles.has(String(id))) return;
  if (store.list('docs').some((d) => d.driveFileId === id)) return;
  throw denied('הקובץ');
}

/** The calendar to use: the configured one, or a user's own calendar recorded in their profile. */
export async function assertCalendar(cfg, id) {
  const store = await realStore(cfg);
  if (!store || !id || id === cfg.google.calendarId) return;
  if (store.list('users').some((u) => u.googleCalendarId === id)) return;
  throw new HttpError(403, 'calendar_not_allowed', 'היומן הזה לא משויך למערכת');
}

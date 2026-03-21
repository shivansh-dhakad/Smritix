/**
 * api.js — Centralized Smritix API client.
 * All fetch calls go through here so error handling is consistent.
 */

const BASE = '';  // Same origin

async function request(method, path, body = null, isForm = false) {
  const opts = {
    method,
    headers: isForm ? {} : { 'Content-Type': 'application/json' },
  };
  if (body) {
    opts.body = isForm ? body : JSON.stringify(body);
  }
  try {
    const res = await fetch(BASE + path, opts);
    const data = await res.json().catch(() => ({ success: false, error: 'Invalid JSON response' }));
    if (!data.success) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data.data ?? data;
  } catch (err) {
    // Re-throw with consistent Error type
    throw err instanceof Error ? err : new Error(String(err));
  }
}

const get    = (path)         => request('GET',    path);
const post   = (path, body)   => request('POST',   path, body);
const put    = (path, body)   => request('PUT',    path, body);
const del    = (path)         => request('DELETE', path);
const upload = (path, form)   => request('POST',   path, form, true);

// ── Courses ──────────────────────────────────────────────────
export const Courses = {
  list:   ()          => get('/api/courses'),
  get:    (id)        => get(`/api/courses/${id}`),
  create: (data)      => post('/api/courses', data),
  update: (id, data)  => put(`/api/courses/${id}`, data),
  delete: (id)        => del(`/api/courses/${id}`),
};

// ── Sections ─────────────────────────────────────────────────
export const Sections = {
  list:   (courseId, parentId = null) =>
    get(`/api/sections?course_id=${courseId}` + (parentId !== null ? `&parent_id=${parentId}` : '')),
  get:    (id)        => get(`/api/sections/${id}`),
  create: (data)      => post('/api/sections', data),
  update: (id, data)  => put(`/api/sections/${id}`, data),
  delete: (id)        => del(`/api/sections/${id}`),
};

// ── Notes ────────────────────────────────────────────────────
export const Notes = {
  list:    (courseId, sectionId = null) =>
    get(`/api/notes?course_id=${courseId}` + (sectionId ? `&section_id=${sectionId}` : '')),
  get:     (id, render = false) => get(`/api/notes/${id}?render=${render}`),
  create:  (data)      => post('/api/notes', data),
  update:  (id, data)  => put(`/api/notes/${id}`, data),
  delete:  (id)        => del(`/api/notes/${id}`),
  versions: (id)       => get(`/api/notes/${id}/versions`),
  restore: (noteId, versionId) => post(`/api/notes/${noteId}/restore/${versionId}`),
  render:  (id, content) => post(`/api/notes/${id}/render`, { content }),
};

// ── Projects ─────────────────────────────────────────────────
export const Projects = {
  list:    (courseId, sectionId = null) =>
    get(`/api/projects?course_id=${courseId}` + (sectionId ? `&section_id=${sectionId}` : '')),
  get:     (id)       => get(`/api/projects/${id}`),
  create:  (data)     => post('/api/projects', data),
  update:  (id, data) => put(`/api/projects/${id}`, data),
  delete:  (id)       => del(`/api/projects/${id}`),

  // Files
  files:       (pid, parentId = null) =>
    get(`/api/projects/${pid}/files?parent_id=${parentId ?? 'null'}`),
  upload:      (pid, formData)        => upload(`/api/projects/${pid}/upload`, formData),
  fileContent: (pid, fid)             => get(`/api/projects/${pid}/files/${fid}/content`),
  saveFile:    (pid, fid, content)    => put(`/api/projects/${pid}/files/${fid}/content`, { content }),
  deleteFile:  (pid, fid)             => del(`/api/projects/${pid}/files/${fid}`),

  run: (id, type) => post(`/api/projects/${id}/run`, { type }),
};

// ── Search ───────────────────────────────────────────────────
export const Search = {
  query: (q) => get(`/api/search?q=${encodeURIComponent(q)}`),
};

// ── Misc ─────────────────────────────────────────────────────
export const Settings = {
  get:    ()     => get('/api/settings'),
  update: (data) => put('/api/settings', data),
};

export const Backup = {
  create:  ()         => post('/api/backup'),
  list:    ()         => get('/api/backups'),
  restore: (filename) => post('/api/backups/restore', { filename }),
};

export const Health = {
  check: () => get('/api/health'),
};

export const Dashboard = {
  get: () => get('/api/dashboard'),
};

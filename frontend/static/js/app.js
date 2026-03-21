/**
 * app.js — Smritix Final
 * WYSIWYG notes · Dashboard · Project explorer with tabs · Fixed toolbar
 */

import { Courses, Sections, Notes, Projects, Search, Settings, Backup, Dashboard } from './api.js';
import { toast, setBreadcrumb, showLoading, formatDate, formatSize, fileIcon, escapeHtml } from './ui.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const COURSE_EMOJIS = ['📚', '📖', '🎓', , '💻'];
const PROJECT_EMOJIS = ['🚀', '💡', '⚡', '🌐'];
const PALETTE = ['#7c6af7', '#00d4bc', '#f5a623', '#ef4444', '#22c55e', '#3b82f6', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#a78bfa'];

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  courses: [], currentCourse: null, currentSection: null,
  currentNote: null, currentProject: null,
  view: 'dashboard', autosaveTimer: null, noteModified: false,
  editMode: false, openFileTabs: [],   // {id, name, projectId}
  activeFileTab: null,
};

const $content = () => document.getElementById('content');
const $sidebar = () => document.getElementById('sidebar-nav');

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const cfg = await Settings.get().catch(() => ({}));
    if (cfg.setup_complete !== 'true') { window.location.href = '/setup'; return; }
  } catch (_) { }
  await loadCourses();
  await renderDashboard();
  setupSearch();
  setupKeys();
}

async function loadCourses() {
  try { S.courses = await Courses.list(); renderSidebar(); }
  catch (e) { toast('Failed to load courses: ' + e.message, 'error'); }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar() {
  const nav = $sidebar(); if (!nav) return;
  nav.innerHTML = '';
  const dashEl = mkEl('div', 'nav-item' + (S.view === 'dashboard' ? ' active' : ''),
    `<span class="nav-emoji"></span><span class="nav-label">Dashboard</span>`);
  dashEl.onclick = renderDashboard;
  nav.appendChild(dashEl);

  const lbl = mkEl('div', 'sidebar-section-label',
    `<span>Courses</span><button onclick="window._newCourse()" title="New course">+</button>`);
  nav.appendChild(lbl);

  if (!S.courses.length) {
    nav.appendChild(mkEl('div', '', '<div style="padding:10px;font-size:.78rem;color:var(--t3)">No courses yet</div>'));
    return;
  }
  S.courses.forEach(c => {
    const el = mkEl('div', 'nav-item' + (S.currentCourse?.id === c.id && S.view !== 'dashboard' ? ' active' : ''),
      `<span class="nav-emoji">${c.emoji}</span>
       <span class="nav-label">${escapeHtml(c.name)}</span>
       <span class="nav-chevron">›</span>
       <span class="nav-actions">
         <button class="nav-action-btn" onclick="event.stopPropagation();window._editCourse(${c.id})" title="Edit">Edit</button>
         <button class="nav-action-btn" onclick="event.stopPropagation();window._deleteCourse(${c.id})" title="Delete">Delete</button>
       </span>`);
    el.onclick = () => navCourse(c);
    nav.appendChild(el);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function mkEl(tag, cls, html = '') {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

// ── Recently viewed ───────────────────────────────────────────────────────────
function trackRecent(type, id, title, extra = {}) {
  try {
    const items = JSON.parse(localStorage.getItem('smritix_recent') || '[]');
    const entry = { type, id, title, ...extra, ts: Date.now() };
    const clean = items.filter(x => !(x.type === type && x.id === id));
    clean.unshift(entry);
    localStorage.setItem('smritix_recent', JSON.stringify(clean.slice(0, 16)));
  } catch (_) { }
}
function getRecent() {
  try { return JSON.parse(localStorage.getItem('smritix_recent') || '[]'); }
  catch (_) { return []; }
}
function removeRecent(type, id) {
  try {
    const items = getRecent();
    const clean = items.filter(x => !(x.type === type && x.id === id));
    localStorage.setItem('smritix_recent', JSON.stringify(clean));
  } catch (_) { }
}

// ── Navigation ────────────────────────────────────────────────────────────────
async function renderDashboard() {
  S.view = 'dashboard'; S.currentCourse = S.currentSection = S.currentNote = S.currentProject = null;
  renderSidebar();
  setBreadcrumb([{ label: 'Dashboard' }]);
  showLoading($content());
  try {
    const data = await Dashboard.get();
    const { stats, recent_notes, recent_projects, courses_summary } = data;
    const recent = getRecent().filter(r => r.type === 'note' || r.type === 'project').slice(0, 8);
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';

    $content().innerHTML = `
      <div class="dashboard-greeting">
        <h2>${greet} 👋</h2>
        <p>Here's what's happening in your knowledge base</p>
      </div>
      <div class="stats-row">
        <div class="stat-card" style="--stat-color:var(--accent);--stat-bg:var(--adim)">
          <div class="stat-icon">📚</div><div><div class="stat-value">${stats.courses}</div><div class="stat-label">Courses</div></div>
        </div>
        <div class="stat-card" style="--stat-color:var(--teal);--stat-bg:var(--tdim)">
          <div class="stat-icon">📂</div><div><div class="stat-value">${stats.sections}</div><div class="stat-label">Sections</div></div>
        </div>
        <div class="stat-card" style="--stat-color:var(--a2);--stat-bg:var(--a2dim)">
          <div class="stat-icon">📝</div><div><div class="stat-value">${stats.notes}</div><div class="stat-label">Notes</div></div>
        </div>
        <div class="stat-card" style="--stat-color:var(--pink);--stat-bg:rgba(255,107,157,.1)">
          <div class="stat-icon">🚀</div><div><div class="stat-value">${stats.projects}</div><div class="stat-label">Projects</div></div>
        </div>
      </div>
      ${recent_notes.length ? `
      <div class="dash-section">
        <div class="dash-section-header"><span class="dash-section-title">Recently Updated Notes</span></div>
        <div class="recent-notes-grid">
          ${recent_notes.map(n => `
            <div class="recent-note-card" onclick="window._navToNote(${n.id})">
              <div class="recent-note-title">${escapeHtml(n.title)}</div>
              <div class="recent-note-meta"><span>${n.course_emoji} ${escapeHtml(n.course_name)}</span><span>· ${formatDate(n.updated_at)}</span></div>
            </div>`).join('')}
        </div>
      </div>`: ''}
      ${recent_projects.length ? `
      <div class="dash-section">
        <div class="dash-section-header"><span class="dash-section-title">Recent Projects</span></div>
        <div class="recent-projects-grid">
          ${recent_projects.map(p => `
            <div class="recent-proj-card" style="--proj-color:${p.color}" onclick="window._navToProject(${p.id})">
              <span class="recent-proj-emoji">${p.emoji}</span>
              <div class="recent-proj-name">${escapeHtml(p.name)}</div>
              <div class="recent-proj-course">${escapeHtml(p.course_name)}</div>
            </div>`).join('')}
        </div>
      </div>`: ''}
      ${recent.length ? `
      <div class="dash-section">
        <div class="dash-section-header"><span class="dash-section-title">Recently Viewed</span></div>
        <div class="courses-summary-list">
          ${recent.map(r => `
            <div class="course-summary-row" onclick="window._navToRecent('${r.type}',${r.id})">
              <span class="course-summary-emoji">${r.type === 'note' ? '📝' : (r.course_emoji || '🚀')}</span>
              <span class="course-summary-name">${escapeHtml(r.title)}</span>
              <div class="course-summary-chips"><span class="chip">${r.type}</span>${r.course_name ? `<span class="chip" style="color:var(--t3)">${escapeHtml(r.course_name)}</span>` : ''}</div>
            </div>`).join('')}
        </div>
      </div>`: ''}
      ${courses_summary.length ? `
      <div class="dash-section">
        <div class="dash-section-header">
          <span class="dash-section-title">All Courses</span>
          <button class="dash-section-link" onclick="window._showAllCourses()">View all →</button>
        </div>
        <div class="courses-summary-list">
          ${courses_summary.map(c => `
            <div class="course-summary-row" onclick="window._navToCourse(${c.id})">
              <span class="course-summary-emoji">${c.emoji}</span>
              <span class="course-summary-name">${escapeHtml(c.name)}</span>
              <div class="course-summary-chips">
                <span class="chip notes">${c.note_count} notes</span>
                <span class="chip projs">${c.project_count} projects</span>
              </div>
            </div>`).join('')}
        </div>
      </div>`: `
      <div class="empty-state">
        <span class="empty-state-icon">🌱</span>
        <div class="empty-state-title">Your knowledge base is empty</div>
        <div class="empty-state-sub">Create your first course to get started</div>
        <button class="topbar-btn primary" style="margin-top:14px" onclick="window._newCourse()">+ Create Course</button>
      </div>`}`;
  } catch (e) {
    $content().innerHTML = `<div class="empty-state"><span class="empty-state-icon">❌</span>
      <div class="empty-state-title">Dashboard failed to load</div>
      <div class="empty-state-sub">${escapeHtml(e.message)}</div></div>`;
  }
}

window._showAllCourses = () => { S.view = 'home'; renderSidebar(); setBreadcrumb([{ label: '📚 Courses' }]); renderHome(); };
function renderHome() {
  $content().innerHTML = `
    <div class="home-header"><h2>📚 My Courses</h2><p>Select a course to view its contents</p></div>
    <div class="courses-grid">
      ${S.courses.map(c => `
        <div class="course-card" style="--card-color:${c.color}" onclick="window._navToCourse(${c.id})">
          <div class="course-card-actions">
            <button class="card-action-btn" onclick="event.stopPropagation();window._editCourse(${c.id})">Edit</button>
            <button class="card-action-btn" onclick="event.stopPropagation();window._deleteCourse(${c.id})">Delete</button>
          </div>
          <span class="course-card-emoji">${c.emoji}</span>
          <div class="course-card-name">${escapeHtml(c.name)}</div>
          <div class="course-card-desc">${escapeHtml(c.description || 'No description')}</div>
        </div>`).join('')}
      <div class="add-course-card" onclick="window._newCourse()"><span class="plus">＋</span><span>New Course</span></div>
    </div>`;
}

async function navCourse(course) {
  S.currentCourse = course; S.currentSection = null; S.view = 'course';
  renderSidebar();
  setBreadcrumb([{ label: '🏠', action: '_goDash' }, { label: `${course.emoji} ${course.name}` }]);
  await renderCourseView(course);
}

async function navSection(section) {
  S.currentSection = section; S.view = 'section';
  setBreadcrumb([{ label: '🏠', action: '_goDash' }, { label: `${S.currentCourse.emoji} ${S.currentCourse.name}`, action: '_navCourse' }, { label: `📂 ${section.name}` }]);
  await renderSectionView(section);
}

async function navNote(note) {
  S.currentNote = note; S.view = 'note';
  setBreadcrumb([
    { label: '🏠', action: '_goDash' },
    { label: `${S.currentCourse?.emoji || ''} ${S.currentCourse?.name || ''}`, action: '_navCourse' },
    ...(S.currentSection ? [{ label: `📂 ${S.currentSection.name}`, action: '_navSection' }] : []),
    { label: `📝 ${note.title}` }
  ]);
  await renderNoteView(note);
}

async function navProject(project) {
  S.currentProject = project; S.view = 'project'; S.openFileTabs = []; S.activeFileTab = null;
  setBreadcrumb([
    { label: '🏠', action: '_goDash' },
    { label: `${S.currentCourse?.emoji || ''} ${S.currentCourse?.name || ''}`, action: '_navCourse' },
    ...(S.currentSection ? [{ label: `📂 ${S.currentSection.name}`, action: '_navSection' }] : []),
    { label: `${project.emoji} ${project.name}` }
  ]);
  await renderProjectView(project);
}

window._goDash = renderDashboard;
window._navCourse = () => S.currentCourse && navCourse(S.currentCourse);
window._navSection = () => S.currentSection && navSection(S.currentSection);

// ── Course view ───────────────────────────────────────────────────────────────
async function renderCourseView(course) {
  showLoading($content());
  try {
    const [sections, notes, projects] = await Promise.all([
      Sections.list(course.id), Notes.list(course.id), Projects.list(course.id)
    ]);
    const topSections = sections.filter(s => !s.parent_id);
    const topNotes = notes.filter(n => !n.section_id);
    const topProjects = projects.filter(p => !p.section_id);

    $content().innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-title"><span class="title-emoji">${course.emoji}</span>${escapeHtml(course.name)}</div>
          <div class="view-subtitle">${escapeHtml(course.description || '')}</div>
        </div>
        <div class="topbar-actions">
          <button class="topbar-btn primary" onclick="window._newSection(${course.id})">＋ Section</button>
          <button class="topbar-btn primary" onclick="window._newNote(${course.id},null)">＋ Note</button>
          <button class="topbar-btn primary" onclick="window._newProject(${course.id},null)">＋ Project</button>
        </div>
      </div>
      ${topSections.length ? `<div class="content-section"><div class="content-section-title">📂 Sections</div><div class="items-grid">${topSections.map(s => sectionCard(s)).join('')}</div></div>` : ''}
      ${topNotes.length ? `<div class="content-section"><div class="content-section-title">📝 Notes</div><div class="notes-list">${topNotes.map(n => noteRow(n)).join('')}</div></div>` : ''}
      ${topProjects.length ? `<div class="content-section"><div class="content-section-title">🚀 Projects</div><div class="items-grid">${topProjects.map(p => projectCard(p)).join('')}</div></div>` : ''}
      ${!topSections.length && !topNotes.length && !topProjects.length ? `<div class="empty-state"><span class="empty-state-icon">📭</span><div class="empty-state-title">This course is empty</div><div class="empty-state-sub">Add a section, note or project to begin</div></div>` : ''}`;
  } catch (e) { toast('Failed to load course: ' + e.message, 'error'); }
}

async function renderSectionView(section) {
  showLoading($content());
  try {
    const [notes, projects, allSections] = await Promise.all([
      Notes.list(S.currentCourse.id, section.id),
      Projects.list(S.currentCourse.id, section.id),
      Sections.list(S.currentCourse.id)
    ]);
    const children = allSections.filter(s => s.parent_id === section.id);
    $content().innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-title">📂 ${escapeHtml(section.name)}</div>
          <div class="view-subtitle">${S.currentCourse.emoji} ${escapeHtml(S.currentCourse.name)}</div>
        </div>
        <div class="topbar-actions">
          <button class="topbar-btn primary" onclick="window._newSection(${S.currentCourse.id},${section.id})">＋ Sub-section</button>
          <button class="topbar-btn primary" onclick="window._newNote(${S.currentCourse.id},${section.id})">＋ Note</button>
          <button class="topbar-btn primary" onclick="window._newProject(${S.currentCourse.id},${section.id})">＋ Project</button>
        </div>
      </div>
      ${children.length ? `<div class="content-section"><div class="content-section-title">📂 Sub-sections</div><div class="items-grid">${children.map(s => sectionCard(s)).join('')}</div></div>` : ''}
      ${notes.length ? `<div class="content-section"><div class="content-section-title">📝 Notes</div><div class="notes-list">${notes.map(n => noteRow(n)).join('')}</div></div>` : ''}
      ${projects.length ? `<div class="content-section"><div class="content-section-title">🚀 Projects</div><div class="items-grid">${projects.map(p => projectCard(p)).join('')}</div></div>` : ''}
      ${!children.length && !notes.length && !projects.length ? `<div class="empty-state"><span class="empty-state-icon">📭</span><div class="empty-state-title">Empty section</div></div>` : ''}`;
  } catch (e) { toast('Failed to load section: ' + e.message, 'error'); }
}

// ── Card/row helpers ──────────────────────────────────────────────────────────
const sectionCard = s => `
  <div class="item-card" onclick="window._navToSection(${s.id})">
    <div class="item-card-actions">
      <button class="card-action-btn" onclick="event.stopPropagation();window._editSection(${s.id})">Edit</button>
      <button class="card-action-btn" onclick="event.stopPropagation();window._deleteSection(${s.id})">Delete</button>
    </div>
    <div class="item-card-header"><span class="item-card-emoji">📂</span><span class="item-card-name">${escapeHtml(s.name)}</span></div>
  </div>`;

const noteRow = n => `
  <div class="note-row" onclick="window._navToNote(${n.id})">
    <span class="note-row-icon">📝</span>
    <div class="note-row-body"><div class="note-row-title">${escapeHtml(n.title)}</div><div class="note-row-meta">${formatDate(n.updated_at)}</div></div>
    <div class="note-row-actions"><button class="card-action-btn" onclick="event.stopPropagation();window._deleteNote(${n.id})">🗑️</button></div>
  </div>`;

const projectCard = p => `
  <div class="item-card" style="border-top:2px solid ${p.color}" onclick="window._navToProject(${p.id})">
    <div class="item-card-actions">
      <button class="card-action-btn" onclick="event.stopPropagation();window._editProject(${p.id})">Edit</button>
      <button class="card-action-btn" onclick="event.stopPropagation();window._deleteProject(${p.id})">Delete</button>
    </div>
    <div class="item-card-header"><span class="item-card-emoji">${p.emoji}</span><span class="item-card-name">${escapeHtml(p.name)}</span></div>
    <div class="item-card-meta">${escapeHtml(p.description || '')}</div>
  </div>`;

// ══════════════════════════════════════════════════════════════════
// NOTE VIEW — WYSIWYG
// ══════════════════════════════════════════════════════════════════
async function renderNoteView(note) {
  showLoading($content());
  try {
    const nd = await Notes.get(note.id, false);
    S.currentNote = nd; S.editMode = false; S.noteModified = false;
    trackRecent('note', nd.id, nd.title, { course_name: S.currentCourse?.name || '', course_emoji: S.currentCourse?.emoji || '📚' });

    const stored = nd.content || '';
    const isHtml = stored.trim().startsWith('<') && stored.includes('</');
    const displayHtml = isHtml ? stored
      : stored ? `<p style="white-space:pre-wrap">${escapeHtml(stored)}</p>`
        : '';

    $content().innerHTML = `
      <div id="note-view-container">

        <!-- Title + action buttons -->
        <div class="note-toolbar">
          <input class="note-title-input" id="note-title-input" value="${escapeHtml(nd.title)}" placeholder="Note title…" readonly/>
          <div class="autosave-indicator" id="autosave-status">● Saved</div>
          <button class="topbar-btn" onclick="window._noteHistory(${nd.id})" title="History">History</button>
          <button class="topbar-btn" id="note-edit-btn" onclick="window._toggleEditMode()">Edit</button>
          <button class="topbar-btn primary" id="note-save-btn" style="display:none" onclick="window._saveNote()">Save</button>
          <button class="topbar-btn danger" onclick="window._deleteNote(${nd.id})" title="Delete note">Delete</button>
        </div>

        <!-- Sticky floating WYSIWYG toolbar (visible only in edit mode) -->
        <div class="rte-toolbar-bar" id="rte-toolbar-bar">
          <div class="tb-group">
            <button onclick="rte('undo')" title="Undo">↩</button>
            <button onclick="rte('redo')" title="Redo">↪</button>
          </div><span class="sep"></span>
          <div class="tb-group">
            <select class="tb-select" title="Paragraph Style" onchange="rteBlock(this.value)" style="width:80px">
              <option value="">Style</option>
              <option value="p">Normal</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
              <option value="h3">Heading 3</option>
              <option value="pre">Code</option>
              <option value="blockquote">Quote</option>
            </select>
          </div><span class="sep"></span>
          
          
          <div class="tb-group">
            <button onclick="rte('bold')"          title="Bold (Ctrl+B)"><b>B</b></button>
            <button onclick="rte('italic')"        title="Italic (Ctrl+I)"><i>I</i></button>
            <button onclick="rte('underline')"     title="Underline (Ctrl+U)"><u>U</u></button>
            <button onclick="rte('strikeThrough')" title="Strikethrough"><s>S</s></button>
            <button onclick="rte('superscript')"   title="Superscript" style="font-size:.62rem">X²</button>
            <button onclick="rte('subscript')"     title="Subscript"   style="font-size:.62rem">X₂</button>
          </div><span class="sep"></span>
          <div class="tb-group">
            <button class="tb-color-btn" onclick="rteColorPop(event,'tcp')" title="Text Color">
              <span style="font-size:.74rem;font-weight:700">A</span>
              <span class="tb-color-swatch" id="tcp-swatch" style="background:#7c6af7"></span>
            </button>
            <button class="tb-color-btn" onclick="rteColorPop(event,'hlp')" title="Highlight">
              <span style="font-size:.74rem">H</span>
              <span class="tb-color-swatch" id="hlp-swatch" style="background:#facc15"></span>
            </button>
          </div><span class="sep"></span>

          <div class="tb-group">
            <button onclick="rte('justifyLeft')"   title="Left">⇤</button>
            <button onclick="rte('justifyCenter')" title="Center">⇔</button>
            <button onclick="rte('justifyRight')"  title="Right">⇥</button>
            <button onclick="rte('justifyFull')"   title="Justify">≡</button>
          </div><span class="sep"></span>
          <div class="tb-group">
            <button onclick="rte('insertUnorderedList')" title="Bullet list">• List</button>
            <button onclick="rte('insertOrderedList')"   title="Numbered list">1. List</button>
          </div><span class="sep"></span>
          <div class="tb-group">
            <button onclick="rteLink()"   title="Link">🔗</button>
            <button onclick="rteTable()"  title="Table">Table</button>
            <button onclick="rteHR()"     title="Divider">—</button>
            <button onclick="document.getElementById('rte-img-in').click()" title="Image">img</button>
          </div><span class="sep"></span>
          <div class="tb-group">
            <button onclick="rte('removeFormat')" title="Clear formatting" style="color:var(--t3)">✕</button>
          </div>
          <span id="wc-label">0 words</span>
        </div>

        <!-- Scroll body contains editor + preview -->
        <div class="note-scroll-body">
          <div id="note-editor" contenteditable="false" spellcheck="true">${displayHtml || '<p><br></p>'}</div>
          <div id="note-preview">${displayHtml || '<p style="color:var(--t3);font-style:italic">Empty note — click <strong style=\'color:var(--ah)\'>Edit</strong> to start writing.</p>'}</div>
        </div>
      </div>

      <!-- Color popovers (fixed, appended to body to escape overflow clipping) -->
      <div class="color-popover" id="tcp"><div class="cp-label">Text Color</div><div class="cp-row" id="tcp-row"></div><div class="cp-custom"><input type="color" id="tcp-custom" value="#7c6af7" oninput="rteTextColor(this.value)"/><span>Custom</span></div></div>
      <div class="color-popover" id="hlp"><div class="cp-label">Highlight</div><div class="cp-row" id="hlp-row"></div><div class="cp-custom"><input type="color" id="hlp-custom" value="#facc15" oninput="rteHighlight(this.value)"/><span>Custom</span></div></div>
      <input type="file" id="rte-img-in" accept="image/*" style="display:none" onchange="rteImage(this)"/>`;

    setupRTE(nd);
  } catch (e) { toast('Failed to load note: ' + e.message, 'error'); }
}

// ── RTE setup ─────────────────────────────────────────────────────────────────
const TCP_COLORS = ['#efefef', '#888', '#7c6af7', '#9d8fff', '#00d4bc', '#f5a623', '#ef4444', '#22c55e', '#3b82f6', '#ec4899', '#f97316', '#facc15'];
const HLP_COLORS = ['#facc1550', '#f5a62340', '#22c55e35', '#3b82f635', '#ef444435', '#7c6af735', 'transparent'];

function setupRTE(note) {
  const ed = document.getElementById('note-editor');
  if (!ed) return;

  ['tcp-row', 'hlp-row'].forEach((rowId, i) => {
    const row = document.getElementById(rowId);
    if (!row) return;
    const colors = i === 0 ? TCP_COLORS : HLP_COLORS;
    const fn = i === 0 ? 'rteTextColor' : 'rteHighlight';
    row.innerHTML = colors.map(c =>
      `<div class="cp-swatch" style="background:${c === 'transparent' ? 'linear-gradient(135deg,#fff 45%,red 45%)' : c}"
            onclick="${fn}('${c}')" title="${c}"></div>`).join('');
  });

  ed.addEventListener('input', () => {
    S.noteModified = true;
    const as = document.getElementById('autosave-status');
    if (as) { as.textContent = '✏ Editing…'; as.className = 'autosave-indicator saving'; }
    scheduleAutosave(note.id);
    wcUpdate();
  });
  ed.addEventListener('keyup', saveSelection);
  ed.addEventListener('mouseup', saveSelection);
  ed.addEventListener('mouseleave', saveSelection);
  ed.addEventListener('focus', saveSelection);
  document.getElementById('note-title-input')?.addEventListener('input', () => {
    S.noteModified = true; scheduleAutosave(note.id);
  });
  document.addEventListener('mousedown', rteClosePopovers);
}

let savedRange = null;
function saveSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    savedRange = sel.getRangeAt(0);
  }
}
function restoreSelection() {
  const ed = document.getElementById('note-editor');
  if (!ed) return;
  ed.focus();
  if (savedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
}

function wcUpdate() {
  const ed = document.getElementById('note-editor');
  const wc = document.getElementById('wc-label');
  if (!ed || !wc) return;
  const words = (ed.innerText || '').trim().split(/\s+/).filter(Boolean).length;
  wc.textContent = words + (words === 1 ? ' word' : ' words');
}

// ── RTE commands ──────────────────────────────────────────────────────────────
function rte(cmd) { restoreSelection(); document.execCommand(cmd, false, null); }
function rteFontFace(v) { if (!v) return; restoreSelection(); document.execCommand('fontName', false, v); }
function rteFontSize(v) { if (!v) return; restoreSelection(); document.execCommand('fontSize', false, v); }
function rteBlock(v) { if (!v) return; restoreSelection(); document.execCommand('formatBlock', false, v); }
function rteTextColor(v) {
  restoreSelection();
  document.execCommand('foreColor', false, v);
  const sw = document.getElementById('tcp-swatch'); if (sw) sw.style.background = v;
  document.getElementById('tcp').classList.remove('show');
}
function rteHighlight(v) {
  restoreSelection();
  document.execCommand('hiliteColor', false, v === 'transparent' ? 'transparent' : v);
  const sw = document.getElementById('hlp-swatch'); if (sw) sw.style.background = v;
  document.getElementById('hlp').classList.remove('show');
}
function rteColorPop(e, popId) {
  e.stopPropagation();
  const sel = window.getSelection();
  const pop = document.getElementById(popId); if (!pop) return;
  document.querySelectorAll('.color-popover').forEach(p => { if (p.id !== popId) p.classList.remove('show'); });
  if (pop.classList.contains('show')) { pop.classList.remove('show'); return; }
  const r = e.currentTarget.getBoundingClientRect();
  pop.style.left = Math.min(r.left, window.innerWidth - 210) + 'px';
  pop.style.top = (r.bottom + 4) + 'px';
  pop.classList.add('show');
}
function rteClosePopovers(e) {
  if (!e.target.closest('.color-popover') && !e.target.closest('.tb-color-btn'))
    document.querySelectorAll('.color-popover').forEach(p => p.classList.remove('show'));
}
function rteLink() {
  restoreSelection();
  const url = prompt('URL:', 'https://'); if (!url) return;
  restoreSelection(); // Restore again in case prompt blurred the window
  const sel = window.getSelection();
  if (sel && sel.toString()) document.execCommand('createLink', false, url);
  else document.execCommand('insertHTML', false, `<a href="${url}" target="_blank">${url}</a>`);
}
function rteTable() {
  const r = parseInt(prompt('Rows:', '3') || '3', 10);
  const c = parseInt(prompt('Columns:', '3') || '3', 10);
  if (!r || !c) return;
  let html = '<table><thead><tr>' + Array(c).fill('<th>Header</th>').join('') + '</tr></thead><tbody>';
  for (let i = 0; i < r - 1; i++) html += '<tr>' + Array(c).fill('<td>Cell</td>').join('') + '</tr>';
  html += '</tbody></table><p></p>';
  restoreSelection(); document.execCommand('insertHTML', false, html);
}
function rteHR() { restoreSelection(); document.execCommand('insertHTML', false, '<hr/><p></p>'); }
function rteImage(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    restoreSelection(); document.execCommand('insertHTML', false, `<img src="${e.target.result}" alt="${escapeHtml(input.files[0].name)}" style="max-width:100%"/><p></p>`);
  };
  reader.readAsDataURL(input.files[0]); input.value = '';
}

Object.assign(window, {
  rte, rteFontFace, rteFontSize, rteBlock, rteTextColor, rteHighlight,
  rteColorPop, rteClosePopovers, rteLink, rteTable, rteHR, rteImage
});

// ── Edit mode toggle ──────────────────────────────────────────────────────────
window._toggleEditMode = async () => {
  const ed = document.getElementById('note-editor');
  const preview = document.getElementById('note-preview');
  const toolbar = document.getElementById('rte-toolbar-bar');
  const editBtn = document.getElementById('note-edit-btn');
  const saveBtn = document.getElementById('note-save-btn');
  const titleIn = document.getElementById('note-title-input');
  if (!ed) return;

  S.editMode = !S.editMode;
  if (S.editMode) {
    ed.contentEditable = 'true'; ed.style.display = 'block';
    preview.style.display = 'none';
    toolbar?.classList.add('show');
    editBtn.textContent = '👁 Preview';
    saveBtn.style.display = 'inline-flex';
    titleIn?.removeAttribute('readonly');
    ed.focus();
    // cursor to end
    const range = document.createRange(); range.selectNodeContents(ed); range.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    wcUpdate();
  } else {
    await doAutosave(S.currentNote.id);
    preview.innerHTML = ed.innerHTML;
    ed.contentEditable = 'false'; ed.style.display = 'none';
    preview.style.display = 'block';
    toolbar?.classList.remove('show');
    editBtn.textContent = '✏️ Edit';
    saveBtn.style.display = 'none';
    titleIn?.setAttribute('readonly', '');
    document.removeEventListener('mousedown', rteClosePopovers);
  }
};

// ── Autosave ──────────────────────────────────────────────────────────────────
function scheduleAutosave(noteId) {
  clearTimeout(S.autosaveTimer);
  S.autosaveTimer = setTimeout(() => doAutosave(noteId), 2500);
}

async function doAutosave(noteId) {
  const ed = document.getElementById('note-editor');
  const titleIn = document.getElementById('note-title-input');
  const as = document.getElementById('autosave-status');
  if (!ed || !S.noteModified) return;
  try {
    const updated = await Notes.update(noteId, {
      content: ed.innerHTML,
      title: titleIn?.value || S.currentNote.title,
    });
    S.currentNote = updated; S.noteModified = false;
    if (as) { as.textContent = '● Saved'; as.className = 'autosave-indicator saved'; }
  } catch (e) {
    if (as) { as.textContent = '✗ Save failed'; as.className = 'autosave-indicator'; }
    toast('Autosave failed: ' + e.message, 'error');
  }
}

window._saveNote = () => { S.noteModified = true; if (S.currentNote) doAutosave(S.currentNote.id); };

window._noteHistory = async (noteId) => {
  try {
    const versions = await Notes.versions(noteId);
    const ov = document.getElementById('modal-overlay'), box = document.getElementById('modal-box');
    box.innerHTML = `
      <h3 class="modal-title">🕐 Version History</h3>
      <p style="font-size:.78rem;color:var(--t3);margin-bottom:10px">${versions.length} version${versions.length !== 1 ? 's' : ''}</p>
      <div class="version-list">
        ${versions.length ? versions.map(v => `
          <div class="version-item">
            <div><div class="version-date">${formatDate(v.created_at)}</div>
            <div class="version-preview">${escapeHtml((v.preview || '').replace(/<[^>]+>/g, '').slice(0, 70))}…</div></div>
            <button class="restore-btn" onclick="window._restoreVer(${noteId},${v.id})">Restore</button>
          </div>`).join('')
        : '<div class="empty-state" style="padding:20px"><div class="empty-state-sub">No versions yet</div></div>'}
      </div>
      <div class="modal-actions" style="margin-top:14px">
        <button class="modal-btn cancel" onclick="document.getElementById('modal-overlay').classList.remove('show')">Close</button>
      </div>`;
    ov.classList.add('show');
  } catch (e) { toast('Error loading history: ' + e.message, 'error'); }
};

window._restoreVer = async (noteId, vid) => {
  const ok = await showConfirm('Restore this version?', '↩️ Restore');
  if (!ok) return;
  try {
    const note = await Notes.restore(noteId, vid);
    document.getElementById('modal-overlay').classList.remove('show');
    toast('Restored!', 'success');
    await renderNoteView(note);
  } catch (e) { toast('Error: ' + e.message, 'error'); }
};

// ══════════════════════════════════════════════════════════════════
// PROJECT VIEW — redesigned with hero + tabs + file explorer
// ══════════════════════════════════════════════════════════════════
async function renderProjectView(project) {
  showLoading($content());
  try {
    const [proj, files] = await Promise.all([Projects.get(project.id), Projects.files(project.id, null)]);
    trackRecent('project', proj.id, proj.name, { course_name: S.currentCourse?.name || '', course_emoji: proj.emoji });

    $content().innerHTML = `
      <!-- Hero card -->
      <div class="project-hero" style="--proj-accent:${proj.color}">
        <div class="project-hero-icon">${proj.emoji}</div>
        <div class="project-hero-info">
          <div class="project-hero-name">${escapeHtml(proj.name)}</div>
          <div class="project-hero-desc">${escapeHtml(proj.description || 'No description.')}</div>
          <div class="project-hero-badges">
            <span class="proj-badge">📁 ${files.length} file${files.length !== 1 ? 's' : ''}</span>
            <span class="proj-badge">📅 ${formatDate(proj.created_at)}</span>
            ${proj.run_local_path ? `<span class="proj-badge local">▶ Local</span>` : ''}
            ${proj.run_web_url ? `<span class="proj-badge web">🌐 Web</span>` : ''}
          </div>
        </div>
        <div class="project-hero-actions">
          ${proj.run_local_path ? `<button class="run-btn local" onclick="window._runProject(${proj.id},'local')">▶ Run Locally</button>` : ''}
          ${proj.run_web_url ? `<button class="run-btn web" onclick="window._runProject(${proj.id},'web')">🌐 Open URL</button>` : ''}
          <button class="topbar-btn" onclick="window._editProject(${proj.id})">✏️ Edit</button>
          <button class="topbar-btn danger" onclick="window._deleteProject(${proj.id})">🗑️ Delete</button>
        </div>
      </div>

      <!-- Tab bar -->
      <div class="project-tabs">
        <button class="project-tab active" id="tab-files" onclick="switchProjectTab('files')">📁 Files</button>
        <button class="project-tab" id="tab-info" onclick="switchProjectTab('info')">ℹ️ Info</button>
      </div>

      <!-- Files tab -->
      <div id="proj-tab-files">
        <div class="file-explorer" id="file-explorer">
          <div class="file-explorer-header">
            <span class="file-explorer-title">📁 ${escapeHtml(proj.name)}</span>
            <span style="font-size:.72rem;color:var(--t3);font-family:'JetBrains Mono',monospace">${files.length} items</span>
            <button class="topbar-btn" onclick="window._uploadFiles(${proj.id})" style="margin-left:auto">⬆️ Upload</button>
          </div>
          <div id="file-tree-root">${renderFileTree(files, proj.id)}</div>
        </div>

        <div class="drop-zone" id="drop-zone-${proj.id}">📂 Drag &amp; drop files here to upload</div>

        <!-- Open file tabs + editor -->
        <div id="file-editor-panel" style="display:none" class="file-editor-panel">
          <div class="file-editor-header">
            <div class="file-editor-tabs" id="file-editor-tabs"></div>
            <button class="topbar-btn primary" onclick="window._saveCurrentFile(${proj.id})">💾 Save</button>
            <button class="topbar-btn" onclick="closeAllFileTabs()">✕</button>
          </div>
          <div id="file-editor-body"></div>
        </div>
      </div>

      <!-- Info tab -->
      <div id="proj-tab-info" style="display:none">
        <div style="background:var(--s1);border:1px solid var(--b1);border-radius:var(--rl);padding:20px 24px;margin-top:0">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
            <div>
              <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--t3);margin-bottom:6px">Description</div>
              <div style="font-size:.87rem;color:var(--t2);line-height:1.7">${escapeHtml(proj.description || '—')}</div>
            </div>
            <div>
              <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--t3);margin-bottom:6px">Details</div>
              <div style="font-size:.82rem;color:var(--t2);line-height:2.2">
                📅 Created: ${formatDate(proj.created_at)}<br>
                🔄 Updated: ${formatDate(proj.updated_at)}<br>
                📁 Files: ${files.length}
              </div>
            </div>
            ${proj.run_local_path ? `<div>
              <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--t3);margin-bottom:6px">Local Run Path</div>
              <div style="font-family:'JetBrains Mono',monospace;font-size:.79rem;color:var(--ah);word-break:break-all">${escapeHtml(proj.run_local_path)}</div>
            </div>`: ''}
            ${proj.run_web_url ? `<div>
              <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--t3);margin-bottom:6px">Web URL</div>
              <a href="${escapeHtml(proj.run_web_url)}" target="_blank" style="font-size:.82rem;word-break:break-all">${escapeHtml(proj.run_web_url)}</a>
            </div>`: ''}
          </div>
        </div>
      </div>`;

    setupDropZone(proj.id);
  } catch (e) { toast('Failed to load project: ' + e.message, 'error'); }
}

window.switchProjectTab = (tab) => {
  ['files', 'info'].forEach(t => {
    const btn = document.getElementById(`tab-${t}`);
    const pane = document.getElementById(`proj-tab-${t}`);
    const active = t === tab;
    btn?.classList.toggle('active', active);
    if (pane) pane.style.display = active ? 'block' : 'none';
  });
};

function renderFileTree(files, projectId, indent = 0) {
  if (!files.length) return `<div class="file-empty">No files yet — upload to get started</div>`;
  return files.map(f => `
    <div class="file-tree-row ${f.is_dir ? 'dir' : ''}" style="padding-left:${16 + indent * 14}px"
         ${f.is_dir ? `data-dir-id="${f.id}"` : ''}
         onclick="${f.is_dir ? `window._toggleDir(${projectId},${f.id},this)` :
      `window._openFile(${projectId},${f.id},'${escapeHtml(f.name)}')`}">
      <span class="file-tree-icon" id="ficon-${f.id}">${fileIcon(f.name, f.is_dir)}</span>
      <span class="file-tree-name">${escapeHtml(f.name)}</span>
      <span class="file-tree-size">${f.is_dir ? '' : formatSize(f.file_size)}</span>
      <button class="file-tree-del" onclick="event.stopPropagation();window._deleteFile(${projectId},${f.id})" title="Delete">🗑️</button>
    </div>
    <div id="dir-children-${f.id}" style="display:none"></div>`).join('');
}

window._toggleDir = async (pid, dirId, rowEl) => {
  const childrenEl = document.getElementById(`dir-children-${dirId}`);
  const iconEl = document.getElementById(`ficon-${dirId}`);
  if (!childrenEl) return;
  const isOpen = childrenEl.style.display !== 'none' && childrenEl.innerHTML !== '';
  if (isOpen) {
    childrenEl.style.display = 'none';
    if (iconEl) iconEl.textContent = '📁';
    return;
  }
  if (iconEl) iconEl.textContent = '📂';
  try {
    const children = await Projects.files(pid, dirId);
    childrenEl.innerHTML = children.length
      ? renderFileTree(children, pid, 1)
      : `<div class="file-empty" style="padding-left:30px">Empty folder</div>`;
    childrenEl.style.display = 'block';
  } catch (e) { toast('Error: ' + e.message, 'error'); }
};

function setupDropZone(pid) {
  const zone = document.getElementById(`drop-zone-${pid}`);
  if (!zone) return;
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('drag-over'); };
  zone.ondragleave = () => zone.classList.remove('drag-over');
  zone.ondrop = async e => { e.preventDefault(); zone.classList.remove('drag-over'); await uploadFilesTo(pid, Array.from(e.dataTransfer.files)); };
  zone.onclick = () => window._uploadFiles(pid);
}

// ── File tabs ─────────────────────────────────────────────────────────────────
window._openFile = async (pid, fid, name) => {
  try {
    const data = await Projects.fileContent(pid, fid);
    const panel = document.getElementById('file-editor-panel');
    const tabs = document.getElementById('file-editor-tabs');
    const body = document.getElementById('file-editor-body');
    if (!panel || !tabs || !body) return;

    // Notebook viewer
    if (data.is_notebook && data.notebook) {
      panel.style.display = 'block';
      // Add/activate tab
      addFileTab(fid, name, pid);
      body.innerHTML = `<div class="notebook-viewer">${renderNotebook(data.notebook)}</div>`;
      return;
    }

    if (!data.is_text) { toast('Binary file — cannot display in browser', 'info'); return; }

    panel.style.display = 'block';
    addFileTab(fid, name, pid);
    body.innerHTML = `<textarea id="file-editor-textarea" spellcheck="false">${escapeHtml(data.content)}</textarea>`;
    S.activeFileTab = fid;
  } catch (e) { toast('Error opening file: ' + e.message, 'error'); }
};

function addFileTab(fid, name, pid) {
  const tabs = document.getElementById('file-editor-tabs');
  if (!tabs) return;
  // If already open, just activate it
  const existing = tabs.querySelector(`[data-fid="${fid}"]`);
  if (existing) { tabs.querySelectorAll('.file-tab').forEach(t => t.classList.remove('active')); existing.classList.add('active'); S.activeFileTab = fid; return; }
  tabs.querySelectorAll('.file-tab').forEach(t => t.classList.remove('active'));
  const tab = mkEl('div', 'file-tab active',
    `<span>${fileIcon(name, false)} ${escapeHtml(name)}</span>
     <button class="file-tab-close" onclick="event.stopPropagation();closeFileTab(${fid},${pid})" title="Close">✕</button>`);
  tab.dataset.fid = fid; tab.dataset.pid = pid; tab.dataset.name = name;
  tab.onclick = () => { tabs.querySelectorAll('.file-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); S.activeFileTab = fid; };
  tabs.appendChild(tab);
  S.activeFileTab = fid;
}

window.closeFileTab = (fid, pid) => {
  const tabs = document.getElementById('file-editor-tabs');
  const tab = tabs?.querySelector(`[data-fid="${fid}"]`);
  if (tab) tab.remove();
  if (!tabs?.children.length) closeAllFileTabs();
  else tabs?.lastElementChild?.click();
};

window.closeAllFileTabs = () => {
  const panel = document.getElementById('file-editor-panel');
  if (panel) panel.style.display = 'none';
  S.activeFileTab = null;
};

window._saveCurrentFile = async (pid) => {
  const ta = document.getElementById('file-editor-textarea');
  if (!ta || !S.activeFileTab) { toast('No file open', 'warning'); return; }
  try {
    await Projects.saveFile(pid, S.activeFileTab, ta.value);
    toast('Saved!', 'success');
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
};

window._deleteFile = async (pid, fid) => {
  const ok = await showConfirm('Delete this file permanently?', '🗑️ Delete File');
  if (!ok) return;
  try {
    await Projects.deleteFile(pid, fid);
    toast('File deleted', 'info');
    await renderProjectView(S.currentProject);
  } catch (e) { toast('Error: ' + e.message, 'error'); }
};

window._uploadFiles = pid => {
  const input = document.createElement('input'); input.type = 'file'; input.multiple = true;
  input.onchange = async () => { if (input.files.length) await uploadFilesTo(pid, Array.from(input.files)); };
  input.click();
};

async function uploadFilesTo(pid, files) {
  let ok = 0, fail = 0;
  for (const f of files) {
    const form = new FormData(); form.append('file', f);
    try { await Projects.upload(pid, form); ok++; }
    catch (e) { fail++; console.error('Upload failed:', f.name, e); }
  }
  if (ok) toast(`${ok} file${ok > 1 ? 's' : ''} uploaded`, 'success');
  if (fail) toast(`${fail} upload${fail > 1 ? 's' : ''} failed`, 'error');
  if (ok > 0 && S.currentProject) await renderProjectView(S.currentProject);
}

window._runProject = async (id, type) => {
  if (type === 'local') {
    const ok = await showConfirm('Run the configured local file on your machine?', '▶ Run Project');
    if (!ok) return;
  }
  try {
    const r = await Projects.run(id, type);
    if (r.opened) toast('Opened: ' + r.opened, 'success');
    else if (r.pid) toast(`Running (PID ${r.pid})`, 'success');
    else if (r.cmd) toast('Started: ' + r.cmd, 'success');
    else toast('Started!', 'success');
  } catch (e) { toast('Run failed: ' + e.message, 'error'); }
};

// Notebook renderer
function renderNotebook(nb) {
  if (!nb.cells || !nb.cells.length) return '<p style="color:var(--t3);padding:12px">Empty notebook</p>';
  return nb.cells.map((cell, i) => {
    const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
    const type = cell.cell_type;
    let out = '';
    if (type === 'code' && cell.outputs?.length) {
      out = '<div class="nb-output">' + cell.outputs.map(o => {
        if (o.output_type === 'stream') { const t = Array.isArray(o.text) ? o.text.join('') : o.text; return `<div class="nb-output-text">${escapeHtml(t)}</div>`; }
        if (o.output_type === 'error') { return `<div class="nb-output-text" style="color:var(--err)">${escapeHtml(o.ename + ': ' + o.evalue)}</div>`; }
        if (o.data?.['text/plain']) { const t = Array.isArray(o.data['text/plain']) ? o.data['text/plain'].join('') : o.data['text/plain']; return `<div class="nb-output-text">${escapeHtml(t)}</div>`; }
        return '';
      }).join('') + '</div>';
    }
    return `<div class="nb-cell">
      <div class="nb-cell-header ${type}">[${i + 1}] ${type === 'code' ? '⬡ Code' : '📝 Markdown'}</div>
      <div class="nb-cell-source">${escapeHtml(src)}</div>
      ${out}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════
// MODALS — emoji/color pickers
// ══════════════════════════════════════════════════════════════════
function buildEmojiPicker(name, emojis, sel) {
  return `<div class="modal-field"><label>Emoji</label>
    <input type="text" id="mf-${name}" value="${sel || emojis[0]}" style="width:70px;font-size:1.1rem;text-align:center"/>
    <div class="emoji-picker-grid" id="ep-${name}">
      ${emojis.map(e => `<div class="emoji-opt${e === (sel || emojis[0]) ? ' selected' : ''}" data-emoji="${e}" onclick="window._pickEmoji('${name}',this)">${e}</div>`).join('')}
    </div></div>`;
}
window._pickEmoji = (name, el) => {
  document.getElementById(`mf-${name}`).value = el.dataset.emoji;
  document.querySelectorAll(`#ep-${name} .emoji-opt`).forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
};
function buildColorPicker(name, sel) {
  const v = sel || PALETTE[0];
  return `<div class="modal-field"><label>Color</label>
    <div class="color-swatches" id="cs-${name}">
      ${PALETTE.map(c => `<div class="color-swatch${c === v ? ' selected' : ''}" style="background:${c}" data-color="${c}" onclick="window._pickColor('${name}',this)" title="${c}"></div>`).join('')}
    </div>
    <input type="color" id="mf-${name}" value="${v}" style="margin-top:7px;height:30px" oninput="window._syncColor('${name}',this.value)"/></div>`;
}
window._pickColor = (name, el) => {
  document.getElementById(`mf-${name}`).value = el.dataset.color;
  document.querySelectorAll(`#cs-${name} .color-swatch`).forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
};
window._syncColor = (name, v) => { document.querySelectorAll(`#cs-${name} .color-swatch`).forEach(e => e.classList.remove('selected')); };

function openModal({ title, bodyHtml, onConfirm, confirmText = 'Save', confirmClass = 'confirm' }) {
  const ov = document.getElementById('modal-overlay'), box = document.getElementById('modal-box');
  box.innerHTML = `<h3 class="modal-title">${title}</h3>${bodyHtml}
    <div class="modal-actions">
      <button class="modal-btn cancel" id="cm-cancel">Cancel</button>
      <button class="modal-btn ${confirmClass}" id="cm-confirm">${confirmText}</button>
    </div>`;
  ov.classList.add('show');
  document.getElementById('cm-cancel').onclick = () => ov.classList.remove('show');
  document.getElementById('cm-confirm').onclick = () => { ov.classList.remove('show'); onConfirm(); };
  box.querySelectorAll('input:not([type=color]),textarea')[0]?.focus();
  box.onkeydown = e => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') document.getElementById('cm-confirm')?.click(); if (e.key === 'Escape') ov.classList.remove('show'); };
}

function showConfirm(msg, title = 'Are you sure?') {
  return new Promise(resolve => {
    const ov = document.getElementById('modal-overlay'), box = document.getElementById('modal-box');
    box.innerHTML = `<h3 class="modal-title">${title}</h3>
      <p style="color:var(--t2);font-size:.87rem;margin-bottom:20px;line-height:1.6">${msg}</p>
      <div class="modal-actions">
        <button class="modal-btn cancel" id="sc-n">Cancel</button>
        <button class="modal-btn danger" id="sc-y">Confirm</button>
      </div>`;
    ov.classList.add('show');
    document.getElementById('sc-n').onclick = () => { ov.classList.remove('show'); resolve(false); };
    document.getElementById('sc-y').onclick = () => { ov.classList.remove('show'); resolve(true); };
  });
}

// ── CRUD actions ──────────────────────────────────────────────────────────────
window._newCourse = () => openModal({
  title: '📚 New Course',
  bodyHtml: `<div class="modal-field"><label>Name</label><input id="mf-name" placeholder="e.g. Machine Learning"/></div>
            <div class="modal-field"><label>Description</label><textarea id="mf-desc" placeholder="What is this course about?"></textarea></div>
            ${buildEmojiPicker('emoji', COURSE_EMOJIS, '📚')}${buildColorPicker('color', '#7c6af7')}`,
  confirmText: 'Create Course',
  onConfirm: async () => {
    const name = document.getElementById('mf-name')?.value?.trim();
    if (!name) { toast('Name required', 'error'); return; }
    try { const c = await Courses.create({ name, description: document.getElementById('mf-desc')?.value || '', emoji: document.getElementById('mf-emoji')?.value || '📚', color: document.getElementById('mf-color')?.value || '#7c6af7' }); S.courses.push(c); renderSidebar(); toast('Course created!', 'success'); await renderDashboard(); }
    catch (e) { toast('Error: ' + e.message, 'error'); }
  }
});

window._editCourse = id => {
  const c = S.courses.find(x => x.id === id); if (!c) return;
  openModal({
    title: '✏️ Edit Course',
    bodyHtml: `<div class="modal-field"><label>Name</label><input id="mf-name" value="${escapeHtml(c.name)}"/></div>
              <div class="modal-field"><label>Description</label><textarea id="mf-desc">${escapeHtml(c.description || '')}</textarea></div>
              ${buildEmojiPicker('emoji', COURSE_EMOJIS, c.emoji)}${buildColorPicker('color', c.color)}`,
    confirmText: 'Save',
    onConfirm: async () => {
      const name = document.getElementById('mf-name')?.value?.trim(); if (!name) return;
      try { const u = await Courses.update(id, { name, description: document.getElementById('mf-desc')?.value || '', emoji: document.getElementById('mf-emoji')?.value || c.emoji, color: document.getElementById('mf-color')?.value || c.color }); const i = S.courses.findIndex(x => x.id === id); if (i >= 0) S.courses[i] = u; if (S.currentCourse?.id === id) S.currentCourse = u; renderSidebar(); if (S.view === 'course') await renderCourseView(u); else await renderDashboard(); toast('Updated!', 'success'); }
      catch (e) { toast('Error: ' + e.message, 'error'); }
    }
  });
};

window._deleteCourse = async id => {
  const c = S.courses.find(x => x.id === id); if (!c) return;
  const ok = await showConfirm(`Delete "<strong>${escapeHtml(c.name)}</strong>" and all its contents?`, '🗑️ Delete Course');
  if (!ok) return;
  try { await Courses.delete(id); S.courses = S.courses.filter(x => x.id !== id); renderSidebar(); await renderDashboard(); toast('Deleted', 'info'); }
  catch (e) { toast('Error: ' + e.message, 'error'); }
};

window._newSection = (cid, pid = null) => openModal({
  title: '📂 New Section',
  bodyHtml: `<div class="modal-field"><label>Name</label><input id="mf-name" placeholder="e.g. Week 1 — Intro"/></div>`,
  confirmText: 'Create',
  onConfirm: async () => {
    const name = document.getElementById('mf-name')?.value?.trim(); if (!name) return;
    try { await Sections.create({ name, course_id: cid, parent_id: pid }); toast('Section created!', 'success'); if (S.currentCourse) await renderCourseView(S.currentCourse); }
    catch (e) { toast('Error: ' + e.message, 'error'); }
  }
});

window._editSection = id => openModal({
  title: '✏️ Edit Section',
  bodyHtml: `<div class="modal-field"><label>Name</label><input id="mf-name"/></div>`,
  confirmText: 'Save',
  onConfirm: async () => {
    const name = document.getElementById('mf-name')?.value?.trim(); if (!name) return;
    try { await Sections.update(id, { name }); if (S.currentSection?.id === id) S.currentSection.name = name; toast('Updated!', 'success'); if (S.currentCourse) await renderCourseView(S.currentCourse); }
    catch (e) { toast('Error: ' + e.message, 'error'); }
  }
});

window._deleteSection = async id => {
  const ok = await showConfirm('Delete this section and all its contents?', '🗑️ Delete Section');
  if (!ok) return;
  try { await Sections.delete(id); toast('Deleted', 'info'); if (S.currentSection?.id === id) await navCourse(S.currentCourse); else if (S.currentCourse) await renderCourseView(S.currentCourse); }
  catch (e) { toast('Error: ' + e.message, 'error'); }
};

window._newNote = (cid, sid) => openModal({
  title: '📝 New Note',
  bodyHtml: `<div class="modal-field"><label>Title</label><input id="mf-title" value="Untitled Note" placeholder="Note title…"/></div>`,
  confirmText: 'Create',
  onConfirm: async () => {
    try { const n = await Notes.create({ course_id: cid, section_id: sid, title: document.getElementById('mf-title')?.value || 'Untitled Note', content: '' }); toast('Note created!', 'success'); await navNote(n); }
    catch (e) { toast('Error: ' + e.message, 'error'); }
  }
});

window._deleteNote = async id => {
  const ok = await showConfirm('Permanently delete this note?', '🗑️ Delete Note');
  if (!ok) return;
  try { await Notes.delete(id); removeRecent('note', id); toast('Deleted', 'info'); if (S.currentSection) await navSection(S.currentSection); else if (S.currentCourse) await navCourse(S.currentCourse); }
  catch (e) { toast('Error: ' + e.message, 'error'); }
};

window._newProject = (cid, sid) => openModal({
  title: '🚀 New Project',
  bodyHtml: `<div class="modal-field"><label>Name</label><input id="mf-name" placeholder="My Project"/></div>
            <div class="modal-field"><label>Description</label><textarea id="mf-desc" placeholder="What does this project do?"></textarea></div>
            ${buildEmojiPicker('emoji', PROJECT_EMOJIS, '🚀')}${buildColorPicker('color', '#00d4bc')}
            <div class="modal-field"><label>Local Run Path <span style="color:var(--t3)">(optional)</span></label><input id="mf-local" placeholder="/path/to/main.py"/></div>
            <div class="modal-field"><label>Web URL <span style="color:var(--t3)">(optional)</span></label><input id="mf-web" placeholder="http://localhost:3000"/></div>`,
  confirmText: 'Create Project',
  onConfirm: async () => {
    const name = document.getElementById('mf-name')?.value?.trim(); if (!name) { toast('Name required', 'error'); return; }
    try { const p = await Projects.create({ course_id: cid, section_id: sid, name, description: document.getElementById('mf-desc')?.value || '', emoji: document.getElementById('mf-emoji')?.value || '🚀', color: document.getElementById('mf-color')?.value || '#00d4bc', run_local_path: document.getElementById('mf-local')?.value || '', run_web_url: document.getElementById('mf-web')?.value || '' }); toast('Project created!', 'success'); await navProject(p); }
    catch (e) { toast('Error: ' + e.message, 'error'); }
  }
});

window._editProject = id => {
  const p = S.currentProject; if (!p) return;
  openModal({
    title: '✏️ Edit Project',
    bodyHtml: `<div class="modal-field"><label>Name</label><input id="mf-name" value="${escapeHtml(p.name || '')}"/></div>
              <div class="modal-field"><label>Description</label><textarea id="mf-desc">${escapeHtml(p.description || '')}</textarea></div>
              ${buildEmojiPicker('emoji', PROJECT_EMOJIS, p.emoji || '🚀')}${buildColorPicker('color', p.color || '#00d4bc')}
              <div class="modal-field"><label>Local Run Path</label><input id="mf-local" value="${escapeHtml(p.run_local_path || '')}"/></div>
              <div class="modal-field"><label>Web URL</label><input id="mf-web" value="${escapeHtml(p.run_web_url || '')}"/></div>`,
    confirmText: 'Save',
    onConfirm: async () => {
      const name = document.getElementById('mf-name')?.value?.trim(); if (!name) return;
      try { const u = await Projects.update(id, { name, description: document.getElementById('mf-desc')?.value || '', emoji: document.getElementById('mf-emoji')?.value || p.emoji, color: document.getElementById('mf-color')?.value || p.color, run_local_path: document.getElementById('mf-local')?.value || '', run_web_url: document.getElementById('mf-web')?.value || '' }); S.currentProject = u; toast('Updated!', 'success'); await renderProjectView(u); }
      catch (e) { toast('Error: ' + e.message, 'error'); }
    }
  });
};

window._deleteProject = async id => {
  const ok = await showConfirm('Delete this project and all its files?', '🗑️ Delete Project');
  if (!ok) return;
  try { await Projects.delete(id); removeRecent('project', id); toast('Deleted', 'info'); if (S.currentSection) await navSection(S.currentSection); else if (S.currentCourse) await navCourse(S.currentCourse); }
  catch (e) { toast('Error: ' + e.message, 'error'); }
};

// ── Search ────────────────────────────────────────────────────────────────────
const $si = () => document.getElementById('search-input');
const $sd = () => document.getElementById('search-dropdown');

function setupSearch() {
  let timer;
  $si()?.addEventListener('input', () => { clearTimeout(timer); const q = $si().value.trim(); if (!q || q.length < 2) { $sd()?.classList.remove('show'); return; } timer = setTimeout(() => doSearch(q), 280); });
  $si()?.addEventListener('focus', () => { if ($si().value.trim().length >= 2) $sd()?.classList.add('show'); });
  document.addEventListener('click', e => { if (!e.target.closest('.sidebar-search')) $sd()?.classList.remove('show'); });
}

async function doSearch(q) {
  try {
    const r = await Search.query(q);
    const { notes = [], courses = [], sections = [], projects = [] } = r;
    const total = notes.length + courses.length + sections.length + projects.length;
    const sd = $sd(); if (!sd) return;
    if (!total) { sd.innerHTML = '<div class="search-empty">No results</div>'; sd.classList.add('show'); return; }
    let html = '';
    if (notes.length) { html += '<div class="search-group-title">Notes</div>'; html += notes.slice(0, 5).map(n => `<div class="search-item" onclick="window._navToNote(${n.id})"><span>📝</span><span class="search-item-title">${escapeHtml(n.title)}</span></div>`).join(''); }
    if (courses.length) { html += '<div class="search-group-title">Courses</div>'; html += courses.map(c => `<div class="search-item" onclick="window._navToCourse(${c.id})"><span>${c.emoji}</span><span class="search-item-title">${escapeHtml(c.name)}</span></div>`).join(''); }
    if (projects.length) { html += '<div class="search-group-title">Projects</div>'; html += projects.map(p => `<div class="search-item" onclick="window._navToProject(${p.id})"><span>${p.emoji}</span><span class="search-item-title">${escapeHtml(p.name)}</span></div>`).join(''); }
    sd.innerHTML = html; sd.classList.add('show');
  } catch (_) { }
}

// ── Global nav helpers ────────────────────────────────────────────────────────
const closeSearch = () => { const sd = $sd(), si = $si(); if (sd) sd.classList.remove('show'); if (si) si.value = ''; };

window._navToCourse = async id => { const c = S.courses.find(x => x.id === id) || await Courses.get(id); if (c) { S.currentCourse = c; await navCourse(c); } closeSearch(); };
window._navToSection = async id => { const s = await Sections.get(id); if (s) { if (!S.currentCourse) S.currentCourse = S.courses.find(c => c.id === s.course_id); await navSection(s); } closeSearch(); };
window._navToNote = async id => { const n = await Notes.get(id); if (!S.currentCourse) { S.currentCourse = S.courses.find(c => c.id === n.course_id) || await Courses.get(n.course_id); } await navNote(n); closeSearch(); };
window._navToProject = async id => { const p = await Projects.get(id); if (!S.currentCourse) { S.currentCourse = S.courses.find(c => c.id === p.course_id) || await Courses.get(p.course_id); } await navProject(p); closeSearch(); };
window._navToRecent = async (type, id) => { try { if (type === 'note') await window._navToNote(id); else await window._navToProject(id); } catch (e) { toast('Item not found', 'error'); } };

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function setupKeys() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case 'k': e.preventDefault(); $si()?.focus(); $si()?.select(); break;
        case 'n': if (S.currentCourse) { e.preventDefault(); window._newNote(S.currentCourse.id, S.currentSection?.id ?? null); } break;
        case 's': if (S.view === 'note') { e.preventDefault(); window._saveNote(); } break;
      }
    }
  });
}

// ── Sidebar toggle + modal close ──────────────────────────────────────────────
document.getElementById('sidebar-toggle')?.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('collapsed'));
document.getElementById('modal-overlay')?.addEventListener('click', e => { if (e.target === document.getElementById('modal-overlay')) document.getElementById('modal-overlay').classList.remove('show'); });
window._doBackup = async () => { try { await Backup.create(); toast('Backup created!', 'success'); } catch (e) { toast('Backup failed: ' + e.message, 'error'); } };

// ── api.js update — add Dashboard ─────────────────────────────────────────────
// (api.js already exports Dashboard — no changes needed)

boot();

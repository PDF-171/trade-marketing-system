const STATUSES = ["Not started", "In progress", "For approval", "Done"];
const EVENT_TYPES = ["Event", "Installation", "Meeting", "Deadline"];
const GALLERY_CATS = ["Booth setup", "Signage", "Crowd", "Team", "Issue"];
const ROLES = ["Admin", "Coordinator", "Field staff", "Designer"];
const PASTEL_SWATCHES = ["#F7C6C7", "#FBE7A1", "#B5EAD7", "#C7CEEA", "#FFDAC1", "#E2F0CB", "#D6C9F2", "#F6DFEB"];
const DUE_SOON_COLOR = "#C7CEEA"; // upcoming due date — soft periwinkle
const OVERDUE_COLOR = "#F7C6C7"; // overdue due date — soft coral

function darken(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (n >> 16) - amount);
  const g = Math.max(0, ((n >> 8) & 0xff) - amount);
  const b = Math.max(0, (n & 0xff) - amount);
  return `rgb(${r},${g},${b})`;
}

const App = {
  currentUser: null, // { Email, Name, Role }
  cache: {}, // tab -> { headers, rows }
  view: "dashboard",

  async start() {
    document.getElementById("signin-btn").addEventListener("click", () => Auth.signIn());
    Auth.init(() => this.afterSignIn());
  },

  async afterSignIn() {
    const profile = Auth.getProfile();
    try {
      const { headers, rows } = await this.load("Users");
      const match = rows.find(r => (r.Email || "").toLowerCase() === profile.email.toLowerCase());
      if (!match) {
        this.showUnauthorized(profile.email);
        return;
      }
      this.currentUser = match;
      document.getElementById("login-screen").classList.add("hidden");
      document.getElementById("app-shell").classList.remove("hidden");
      document.getElementById("current-user-email").textContent = `${match.Name} (${match.Role})`;
      this.go("dashboard");
    } catch (e) {
      console.error(e);
      this.fatal("Couldn't read the Users tab. Double check the Sheet ID and that Sheets API is enabled.");
    }
  },

  showUnauthorized(email) {
    document.getElementById("login-screen").innerHTML = `
      <div class="login-card">
        <h1>Not on the team list yet</h1>
        <p>Signed in as <strong>${email}</strong>, but this email isn't in the Users sheet.
        Ask your admin to add you, then reload this page.</p>
      </div>`;
  },

  fatal(msg) {
    document.getElementById("login-screen").innerHTML = `<div class="login-card"><h1>Something went wrong</h1><p>${msg}</p></div>`;
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app-shell").classList.add("hidden");
  },

  async load(tab, force = false) {
    if (!force && this.cache[tab]) return this.cache[tab];
    const data = await SheetsAPI.list(tab);
    this.cache[tab] = data;
    return data;
  },

  async go(view) {
    this.view = view;
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    const main = document.getElementById("main");
    main.innerHTML = `<div class="loading">Loading…</div>`;
    try {
      const html = await this[`render_${view}`]();
      main.innerHTML = html;
      this[`wire_${view}`] && this[`wire_${view}`]();
    } catch (e) {
      console.error(e);
      main.innerHTML = `<div class="loading">Couldn't load this view. Check the console for details.</div>`;
    }
  },

  todayISO() { return new Date().toISOString().slice(0, 10); },
  uid() { return Math.random().toString(36).slice(2, 10); },

  // ---------------- Dashboard ----------------
  async render_dashboard() {
    const [{ rows: tasks }, { rows: events }, { rows: reports }] = await Promise.all([
      this.load("Tasks"), this.load("Events"), this.load("Reports"),
    ]);
    const me = this.currentUser.Name;
    const myOpen = tasks.filter(t => t.Assignee === me && t.Status !== "Done");
    const today = this.todayISO();
    const todayEvents = events.filter(e => e.Date === today);
    const upcoming = events.filter(e => e.Date >= today).sort((a, b) => a.Date.localeCompare(b.Date)).slice(0, 5);
    const reportedToday = reports.some(r => r.Author === me && r.Date === today);

    return `
      <h2 class="section-title"><i class="ti ti-layout-dashboard"></i> Dashboard</h2>
      <p class="section-sub">Welcome back, ${me}.</p>
      ${!reportedToday ? `<div class="banner"><i class="ti ti-alert-triangle"></i> You haven't submitted today's daily report yet.
        <button class="link-btn" onclick="App.go('reports')">Submit now</button></div>` : ""}
      <div class="card-grid">
        <div class="card"><div class="card-label">My open tasks</div><div class="card-big">${myOpen.length}</div></div>
        <div class="card"><div class="card-label">Today's calendar</div>
          ${todayEvents.length === 0 ? `<p class="muted">Nothing scheduled today</p>` :
            todayEvents.map(e => `<div class="tag tag-${e.Type}">${e.Type}</div> ${e.Title}<br/>`).join("")}
        </div>
        <div class="card"><div class="card-label">Team tasks in progress</div><div class="card-big">${tasks.filter(t => t.Status === "In progress").length}</div></div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-label">Upcoming events</div>
        ${upcoming.length === 0 ? `<p class="muted">No upcoming events</p>` :
          `<ul class="plain-list">${upcoming.map(e => `<li><span class="tag tag-${e.Type}">${e.Type}</span> ${e.Title} <span class="muted">${e.Date}</span></li>`).join("")}</ul>`}
      </div>`;
  },
  wire_dashboard() {},

  // ---------------- Tasks ----------------
  boardPalette: PASTEL_SWATCHES.map(c => ({ header: darken(c, 40), body: c })),

  async render_tasks() {
    const { rows } = await this.load("Tasks");
    const { rows: users } = await this.load("Users");
    this._taskUsers = users;
    const today = this.todayISO();

    const columns = users.map((u, i) => {
      const body = u.Color && /^#[0-9A-Fa-f]{6}$/.test(u.Color) ? u.Color : this.boardPalette[i % this.boardPalette.length].body;
      return { name: u.Name, header: darken(body, 40), body, tasks: rows.filter(t => t.Assignee === u.Name) };
    });
    const unassigned = rows.filter(t => !users.some(u => u.Name === t.Assignee));
    if (unassigned.length) {
      columns.push({ name: "Unassigned", header: "#8a8879", body: "#c9c7bb", tasks: unassigned });
    }

    const dueBadge = (t) => {
      if (!t.DueDate) return "";
      const overdue = t.DueDate < today && t.Status !== "Done";
      return `<span class="due-badge" style="background:${overdue ? OVERDUE_COLOR : DUE_SOON_COLOR}">${t.DueDate}</span>`;
    };

    return `
      <h2 class="section-title"><i class="ti ti-list-check"></i> Tasks</h2>
      <button class="primary-btn" onclick="App.openTaskForm()"><i class="ti ti-plus"></i> New task</button>
      <div class="board">
        ${columns.map(col => `
          <div class="board-col">
            <div class="board-col-header" style="background:${col.header}">${col.name}</div>
            <div class="board-col-body" style="background:${col.body}">
              ${col.tasks.length ? `<ul class="board-list">
                ${col.tasks.map(t => `<li class="${t.Status === "Done" ? "done" : ""}" onclick="App.openTaskDetail(${t._row})">${t.Title} ${dueBadge(t)}</li>`).join("")}
              </ul>` : `<p class="board-empty">No tasks</p>`}
            </div>
          </div>`).join("")}
      </div>
      <div id="modal-root"></div>`;
  },
  wire_tasks() {},
  openTaskForm() {
    document.getElementById("modal-root").innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>New task</h3>
          <label>Title<input id="f-title" /></label>
          <label>Description<textarea id="f-desc"></textarea></label>
          <label>Assignee<select id="f-assignee">${this._taskUsers.map(u => `<option>${u.Name}</option>`).join("")}</select></label>
          <label>Due date<input type="date" id="f-due" /></label>
          <button class="primary-btn full" onclick="App.submitTask()">Create task</button>
        </div>
      </div>`;
  },
  async submitTask() {
    const fields = {
      ID: this.uid(),
      Title: document.getElementById("f-title").value,
      Description: document.getElementById("f-desc").value,
      Assignee: document.getElementById("f-assignee").value,
      Status: "Not started",
      DueDate: document.getElementById("f-due").value,
      CreatedBy: this.currentUser.Name,
      CreatedAt: this.todayISO(),
    };
    if (!fields.Title.trim()) return;
    const { headers } = await this.load("Tasks");
    await SheetsAPI.append("Tasks", headers, fields);
    document.getElementById("modal-root").innerHTML = "";
    await this.go("tasks");
  },
  async openTaskDetail(rowNumber) {
    const { rows } = await this.load("Tasks");
    const t = rows.find(r => r._row === rowNumber);
    document.getElementById("modal-root").innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>${t.Title}</h3>
          <label>Title<input id="f-title" value="${t.Title}" /></label>
          <label>Description<textarea id="f-desc">${t.Description || ""}</textarea></label>
          <label>Assignee<select id="f-assignee">${this._taskUsers.map(u => `<option ${u.Name === t.Assignee ? "selected" : ""}>${u.Name}</option>`).join("")}</select></label>
          <label>Status<select id="f-status">${STATUSES.map(s => `<option ${s === t.Status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
          <label>Due date<input type="date" id="f-due" value="${t.DueDate || ""}" /></label>
          <button class="primary-btn full" onclick="App.submitTaskEdit(${rowNumber})">Save changes</button>
          <button class="secondary-btn full" style="margin-top:8px" onclick="App.deleteRow('Tasks', ${rowNumber})">Delete task</button>
        </div>
      </div>`;
  },
  async submitTaskEdit(rowNumber) {
    const { headers, rows } = await this.load("Tasks");
    const row = rows.find(r => r._row === rowNumber);
    row.Title = document.getElementById("f-title").value;
    row.Description = document.getElementById("f-desc").value;
    row.Assignee = document.getElementById("f-assignee").value;
    row.Status = document.getElementById("f-status").value;
    row.DueDate = document.getElementById("f-due").value;
    await SheetsAPI.update("Tasks", headers, rowNumber, row);
    document.getElementById("modal-root").innerHTML = "";
    await this.go("tasks");
  },
  async deleteRow(tab, rowNumber) {
    if (!confirm("Remove this entry?")) return;
    await SheetsAPI.remove(tab, rowNumber);
    await this.load(tab, true);
    await this.go(this.view);
  },

  // ---------------- Calendar ----------------
  calMonth: null, // { y, m } — m is 0-indexed
  selectedDay: null,

  async render_calendar() {
    const { rows } = await this.load("Events");
    const today = new Date();
    if (!this.calMonth) this.calMonth = { y: today.getFullYear(), m: today.getMonth() };
    if (!this.selectedDay) this.selectedDay = this.todayISO();

    const { y, m } = this.calMonth;
    const monthName = new Date(y, m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const firstWeekday = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayStr = this.todayISO();

    // date -> array of event types present that day
    const byDate = {};
    rows.forEach(e => {
      if (!e.Date) return;
      (byDate[e.Date] ||= []).push(e.Type || "Event");
    });

    let cells = "";
    for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell empty-cell"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const types = [...new Set(byDate[dateStr] || [])];
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === this.selectedDay;
      cells += `
        <div class="cal-cell${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}" onclick="App.selectDay('${dateStr}')">
          <span class="cal-daynum">${d}</span>
          <div class="cal-dots">${types.slice(0, 4).map(t => `<span class="cal-dot dot-${t}"></span>`).join("")}</div>
        </div>`;
    }

    const dayEvents = rows.filter(e => e.Date === this.selectedDay).sort((a, b) => (a.Title || "").localeCompare(b.Title || ""));
    const selectedLabel = new Date(this.selectedDay + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

    return `
      <h2 class="section-title"><i class="ti ti-calendar"></i> Calendar</h2>
      <div class="cal-header">
        <button class="icon-btn" onclick="App.calNav(-1)"><i class="ti ti-chevron-left"></i></button>
        <strong>${monthName}</strong>
        <button class="icon-btn" onclick="App.calNav(1)"><i class="ti ti-chevron-right"></i></button>
        <button class="primary-btn" style="margin-left:auto" onclick="App.openEventForm()"><i class="ti ti-plus"></i> New entry</button>
      </div>
      <div class="cal-legend">${EVENT_TYPES.map(t => `<span class="legend-item"><span class="cal-dot dot-${t}"></span> ${t}</span>`).join("")}</div>
      <div class="cal-grid">
        ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => `<div class="cal-weekday">${d}</div>`).join("")}
        ${cells}
      </div>
      <div class="card" style="margin-top:16px">
        <div class="row-actions" style="justify-content:space-between">
          <strong>${selectedLabel}</strong>
          <button class="text-btn" onclick="App.openEventForm('${this.selectedDay}')">+ Add entry for this day</button>
        </div>
        <div class="stack" style="margin-top:10px">
          ${dayEvents.length ? dayEvents.map(e => `
            <div class="row-card">
              <div><span class="tag tag-${e.Type}">${e.Type}</span> <span class="row-title">${e.Title}</span>
              ${e.Location ? `<p class="muted small"><i class="ti ti-map-pin"></i> ${e.Location}</p>` : ""}</div>
              <button class="icon-btn" onclick="App.deleteRow('Events', ${e._row})"><i class="ti ti-trash"></i></button>
            </div>`).join("") : `<p class="muted small">Nothing on this day.</p>`}
        </div>
      </div>
      <div id="modal-root"></div>`;
  },
  wire_calendar() {},
  calNav(delta) {
    let { y, m } = this.calMonth;
    m += delta;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    this.calMonth = { y, m };
    this.go("calendar");
  },
  selectDay(dateStr) {
    this.selectedDay = dateStr;
    this.go("calendar");
  },
  openEventForm(prefillDate) {
    document.getElementById("modal-root").innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>New calendar entry</h3>
          <label>Title<input id="f-title" /></label>
          <label>Type<select id="f-type">${EVENT_TYPES.map(t => `<option>${t}</option>`).join("")}</select></label>
          <label>Date<input type="date" id="f-date" value="${prefillDate || this.selectedDay || this.todayISO()}" /></label>
          <label>Location (optional)<input id="f-loc" /></label>
          <button class="primary-btn full" onclick="App.submitEvent()">Add to calendar</button>
        </div>
      </div>`;
  },
  async submitEvent() {
    const fields = {
      ID: this.uid(),
      Title: document.getElementById("f-title").value,
      Type: document.getElementById("f-type").value,
      Date: document.getElementById("f-date").value,
      Location: document.getElementById("f-loc").value,
    };
    if (!fields.Title.trim()) return;
    const { headers } = await this.load("Events");
    await SheetsAPI.append("Events", headers, fields);
    document.getElementById("modal-root").innerHTML = "";
    this.selectedDay = fields.Date;
    await this.go("calendar");
  },

  // ---------------- Daily Reports ----------------
  async render_reports() {
    const { rows } = await this.load("Reports");
    const sorted = [...rows].sort((a, b) => b.Date.localeCompare(a.Date));
    return `
      <h2 class="section-title"><i class="ti ti-file-text"></i> Daily reports</h2>
      <div class="row-actions" style="margin-bottom:12px">
        <button class="secondary-btn" onclick="App.exportReports()">Export CSV</button>
        <button class="primary-btn" onclick="App.openReportForm()"><i class="ti ti-plus"></i> Submit report</button>
      </div>
      <div class="stack">${sorted.length ? sorted.map(r => `
        <div class="row-card block">
          <div class="row-actions" style="justify-content:space-between"><strong>${r.Author}</strong><span class="muted">${r.Date}</span></div>
          ${r.TasksDone ? `<p><span class="pill-green">Done</span> ${r.TasksDone}</p>` : ""}
          ${r.TasksOngoing ? `<p><span class="pill-blue">Ongoing</span> ${r.TasksOngoing}</p>` : ""}
          ${r.Notes ? `<p class="muted small"><em>${r.Notes}</em></p>` : ""}
        </div>`).join("") : `<div class="empty">No reports yet.</div>`}</div>
      <div id="modal-root"></div>`;
  },
  wire_reports() {},
  openReportForm() {
    document.getElementById("modal-root").innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>Daily report — ${this.currentUser.Name}, ${this.todayISO()}</h3>
          <label>Tasks done<textarea id="f-done"></textarea></label>
          <label>Tasks ongoing<textarea id="f-ongoing"></textarea></label>
          <label>Notes (optional)<textarea id="f-notes"></textarea></label>
          <button class="primary-btn full" onclick="App.submitReport()">Submit report</button>
        </div>
      </div>`;
  },
  async submitReport() {
    const fields = {
      ID: this.uid(),
      Author: this.currentUser.Name,
      Date: this.todayISO(),
      TasksDone: document.getElementById("f-done").value,
      TasksOngoing: document.getElementById("f-ongoing").value,
      Notes: document.getElementById("f-notes").value,
    };
    const { headers } = await this.load("Reports");
    await SheetsAPI.append("Reports", headers, fields);
    document.getElementById("modal-root").innerHTML = "";
    await this.go("reports");
  },
  async exportReports() {
    const { rows } = await this.load("Reports", true);
    const csvRows = [["Name", "Date", "Tasks done", "Tasks ongoing", "Notes"],
      ...rows.map(r => [r.Author, r.Date, r.TasksDone, r.TasksOngoing, r.Notes])];
    const csv = csvRows.map(r => r.map(c => `"${(c || "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "daily-reports.csv";
    a.click();
  },

  // ---------------- Gallery ----------------
  async render_gallery() {
    const { rows } = await this.load("Gallery");
    return `
      <h2 class="section-title"><i class="ti ti-photo"></i> Gallery</h2>
      <button class="primary-btn" onclick="App.openGalleryForm()"><i class="ti ti-plus"></i> Add photo</button>
      <div class="gallery-grid">${rows.length ? rows.map(g => `
        <div class="gallery-item">
          <img src="${g.URL}" alt="${g.Caption}" />
          <div class="gallery-meta"><span class="small">${g.Caption || "Untitled"}</span><span class="tag">${g.Category}</span></div>
          <button class="icon-btn gallery-del" onclick="App.deleteRow('Gallery', ${g._row})"><i class="ti ti-trash"></i></button>
        </div>`).join("") : `<div class="empty">No photos yet.</div>`}</div>
      <div id="modal-root"></div>`;
  },
  wire_gallery() {},
  openGalleryForm() {
    document.getElementById("modal-root").innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>Add photo</h3>
          <label>Photo (choose from your device or take one)
            <input type="file" id="f-file" accept="image/*" />
          </label>
          <img id="f-preview" style="display:none;width:100%;max-height:160px;object-fit:cover;margin-top:6px" />
          <label>Caption<input id="f-cap" /></label>
          <label>Category<select id="f-cat">${GALLERY_CATS.map(c => `<option>${c}</option>`).join("")}</select></label>
          <label>Related event (optional)<input id="f-event" /></label>
          <button class="primary-btn full" id="f-submit-btn" onclick="App.submitGallery()">Add to gallery</button>
        </div>
      </div>`;
    document.getElementById("f-file").addEventListener("change", (e) => {
      const file = e.target.files[0];
      const preview = document.getElementById("f-preview");
      if (file) {
        preview.src = URL.createObjectURL(file);
        preview.style.display = "block";
      }
    });
  },
  async submitGallery() {
    const file = document.getElementById("f-file").files[0];
    if (!file) { alert("Choose a photo first."); return; }
    const btn = document.getElementById("f-submit-btn");
    btn.disabled = true;
    btn.textContent = "Uploading…";
    try {
      const { url } = await DriveAPI.uploadImage(file);
      const fields = {
        ID: this.uid(),
        URL: url,
        Caption: document.getElementById("f-cap").value,
        Category: document.getElementById("f-cat").value,
        Event: document.getElementById("f-event").value,
        UploadedBy: this.currentUser.Name,
      };
      const { headers } = await this.load("Gallery");
      await SheetsAPI.append("Gallery", headers, fields);
      document.getElementById("modal-root").innerHTML = "";
      await this.go("gallery");
    } catch (e) {
      console.error(e);
      alert("Upload failed. Check your connection and try again.");
      btn.disabled = false;
      btn.textContent = "Add to gallery";
    }
  },

  // ---------------- History (read-only activity log) ----------------
  async render_history() {
    const { rows } = await this.load("Reports");
    const byDate = {};
    rows.forEach(r => { (byDate[r.Date] ||= []).push(r); });
    const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

    return `
      <h2 class="section-title"><i class="ti ti-history"></i> History</h2>
      <p class="section-sub">A read-only record of what the team has done, day by day — pulled from Daily Reports.</p>
      ${dates.length === 0 ? `<div class="empty">Nothing logged yet. History fills in as people submit daily reports.</div>` :
        dates.map(date => `
          <div class="history-day">
            <h3 class="history-date">${new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h3>
            <div class="stack">
              ${byDate[date].map(r => `
                <div class="row-card block readonly">
                  <strong>${r.Author}</strong>
                  ${r.TasksDone ? `<p><span class="pill-green">Done</span> ${r.TasksDone}</p>` : ""}
                  ${r.TasksOngoing ? `<p><span class="pill-blue">Ongoing</span> ${r.TasksOngoing}</p>` : ""}
                  ${r.Notes ? `<p class="muted small"><em>${r.Notes}</em></p>` : ""}
                </div>`).join("")}
            </div>
          </div>`).join("")}`;
  },
  wire_history() {},

  // ---------------- Team ----------------
  async render_team() {
    const { rows } = await this.load("Users");
    return `
      <h2 class="section-title"><i class="ti ti-users"></i> Team</h2>
      <button class="primary-btn" onclick="App.openTeamForm()"><i class="ti ti-plus"></i> Add member</button>
      <div class="stack">${rows.map(u => `
        <div class="row-card">
          <div class="row-actions">
            <span class="color-dot" style="background:${u.Color || "#c9c7bb"}"></span>
            ${u.Name} ${u.Email === this.currentUser.Email ? '<span class="tag">You</span>' : ""}
          </div>
          <div class="row-actions"><span class="tag">${u.Role}</span>
            <button class="icon-btn" onclick="App.openColorPicker(${u._row}, '${(u.Color || "").replace(/'/g, "")}')" title="Change color"><i class="ti ti-palette"></i></button>
            <button class="icon-btn" onclick="App.deleteRow('Users', ${u._row})"><i class="ti ti-trash"></i></button></div>
        </div>`).join("")}</div>
      <div id="modal-root"></div>`;
  },
  wire_team() {},
  swatchPicker(selected, inputId) {
    return `<div class="swatch-row" id="${inputId}-row">
      ${PASTEL_SWATCHES.map(c => `<button type="button" class="swatch ${c === selected ? "selected" : ""}" style="background:${c}"
        onclick="document.getElementById('${inputId}').value='${c}'; document.querySelectorAll('#${inputId}-row .swatch').forEach(s=>s.classList.remove('selected')); this.classList.add('selected')"></button>`).join("")}
      <input type="hidden" id="${inputId}" value="${selected || PASTEL_SWATCHES[0]}" />
    </div>`;
  },
  openTeamForm() {
    document.getElementById("modal-root").innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>Add team member</h3>
          <label>Google email (must match their login)<input id="f-email" /></label>
          <label>Name<input id="f-name" /></label>
          <label>Role<select id="f-role">${ROLES.map(r => `<option>${r}</option>`).join("")}</select></label>
          <label>Board color (pastel only)${this.swatchPicker(PASTEL_SWATCHES[0], "f-color")}</label>
          <button class="primary-btn full" onclick="App.submitTeam()">Add member</button>
        </div>
      </div>`;
  },
  async submitTeam() {
    const fields = {
      Email: document.getElementById("f-email").value.trim(),
      Name: document.getElementById("f-name").value.trim(),
      Role: document.getElementById("f-role").value,
      Color: document.getElementById("f-color").value,
    };
    if (!fields.Email || !fields.Name) return;
    const { headers } = await this.load("Users");
    await SheetsAPI.append("Users", headers, fields);
    document.getElementById("modal-root").innerHTML = "";
    alert("Added. Remember: they also need to be added as a Test user in Google Auth Platform → Audience, and shared on the Google Sheet, before they can sign in.");
    await this.go("team");
  },
  openColorPicker(rowNumber, currentColor) {
    document.getElementById("modal-root").innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>Choose a board color</h3>
          ${this.swatchPicker(currentColor, "f-color-edit")}
          <button class="primary-btn full" style="margin-top:14px" onclick="App.saveColor(${rowNumber})">Save color</button>
        </div>
      </div>`;
  },
  async saveColor(rowNumber) {
    const { headers, rows } = await this.load("Users");
    const row = rows.find(r => r._row === rowNumber);
    row.Color = document.getElementById("f-color-edit").value;
    await SheetsAPI.update("Users", headers, rowNumber, row);
    document.getElementById("modal-root").innerHTML = "";
    await this.go("team");
  },
};

document.addEventListener("DOMContentLoaded", () => App.start());

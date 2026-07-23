const STATUSES = ["Not started", "In progress", "For approval", "Done"];
const EVENT_TYPES = ["Event", "Installation", "Meeting", "Deadline"];
const GALLERY_CATS = ["Booth setup", "Signage", "Crowd", "Team", "Issue"];
const ROLES = ["Admin", "Coordinator", "Field staff", "Designer"];
const BRANDS = ["Michelin", "BFGoodrich", "Linglong", "Arivo", "Hankook", "Apollo", "Others"];

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
  async render_tasks() {
    const { rows } = await this.load("Tasks");
    const { rows: users } = await this.load("Users");
    this._taskUsers = users;
    return `
      <h2 class="section-title"><i class="ti ti-list-check"></i> Tasks</h2>
      <button class="primary-btn" onclick="App.openTaskForm()"><i class="ti ti-plus"></i> New task</button>
      <div id="task-list" class="stack">${this.taskRows(rows)}</div>
      <div id="modal-root"></div>`;
  },
  taskRows(rows) {
    if (!rows.length) return `<div class="empty">No tasks yet.</div>`;
    return rows.map(t => `
      <div class="row-card">
        <div>
          <p class="row-title">${t.Title}</p>
          ${t.Description ? `<p class="muted">${t.Description}</p>` : ""}
          <p class="muted small">${t.Assignee || "Unassigned"} ${t.DueDate ? " · due " + t.DueDate : ""}</p>
        </div>
        <div class="row-actions">
          <select onchange="App.updateTaskStatus(${t._row}, this.value)">
            ${STATUSES.map(s => `<option ${s === t.Status ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          <button class="icon-btn" onclick="App.deleteRow('Tasks', ${t._row})"><i class="ti ti-trash"></i></button>
        </div>
      </div>`).join("");
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
  async updateTaskStatus(rowNumber, status) {
    const { headers, rows } = await this.load("Tasks");
    const row = rows.find(r => r._row === rowNumber);
    row.Status = status;
    await SheetsAPI.update("Tasks", headers, rowNumber, row);
  },
  async deleteRow(tab, rowNumber) {
    if (!confirm("Remove this entry?")) return;
    await SheetsAPI.remove(tab, rowNumber);
    await this.load(tab, true);
    await this.go(this.view);
  },

  // ---------------- Calendar ----------------
  async render_calendar() {
    const { rows } = await this.load("Events");
    const sorted = [...rows].sort((a, b) => a.Date.localeCompare(b.Date));
    return `
      <h2 class="section-title"><i class="ti ti-calendar"></i> Calendar</h2>
      <button class="primary-btn" onclick="App.openEventForm()"><i class="ti ti-plus"></i> New entry</button>
      <div class="stack">${sorted.length ? sorted.map(e => `
        <div class="row-card">
          <div><span class="tag tag-${e.Type}">${e.Type}</span> <span class="row-title">${e.Title}</span>
          ${e.Location ? `<p class="muted small"><i class="ti ti-map-pin"></i> ${e.Location}</p>` : ""}</div>
          <div class="row-actions"><span class="muted">${e.Date}</span>
            <button class="icon-btn" onclick="App.deleteRow('Events', ${e._row})"><i class="ti ti-trash"></i></button></div>
        </div>`).join("") : `<div class="empty">No calendar entries yet.</div>`}</div>
      <div id="modal-root"></div>`;
  },
  wire_calendar() {},
  openEventForm() {
    document.getElementById("modal-root").innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>New calendar entry</h3>
          <label>Title<input id="f-title" /></label>
          <label>Type<select id="f-type">${EVENT_TYPES.map(t => `<option>${t}</option>`).join("")}</select></label>
          <label>Date<input type="date" id="f-date" value="${this.todayISO()}" /></label>
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
          <label>Image URL (e.g. a Google Drive share link)<input id="f-url" /></label>
          <label>Caption<input id="f-cap" /></label>
          <label>Category<select id="f-cat">${GALLERY_CATS.map(c => `<option>${c}</option>`).join("")}</select></label>
          <label>Related event (optional)<input id="f-event" /></label>
          <button class="primary-btn full" onclick="App.submitGallery()">Add to gallery</button>
        </div>
      </div>`;
  },
  async submitGallery() {
    const fields = {
      ID: this.uid(),
      URL: document.getElementById("f-url").value,
      Caption: document.getElementById("f-cap").value,
      Category: document.getElementById("f-cat").value,
      Event: document.getElementById("f-event").value,
      UploadedBy: this.currentUser.Name,
    };
    if (!fields.URL.trim()) return;
    const { headers } = await this.load("Gallery");
    await SheetsAPI.append("Gallery", headers, fields);
    document.getElementById("modal-root").innerHTML = "";
    await this.go("gallery");
  },

  // ---------------- Brand Library ----------------
  async render_brand() {
    const { rows } = await this.load("Brands");
    return `
      <h2 class="section-title"><i class="ti ti-books"></i> Brand library</h2>
      <p class="section-sub">Links out to your Drive folders per brand.</p>
      <div class="brand-grid">${BRANDS.map(b => `
        <div class="card">
          <div class="row-actions" style="justify-content:space-between">
            <strong>${b}</strong>
            <button class="icon-btn" onclick="App.openBrandForm('${b}')"><i class="ti ti-plus"></i></button>
          </div>
          <ul class="plain-list">${rows.filter(r => r.Brand === b).map(r => `
            <li><a href="${r.URL}" target="_blank" rel="noreferrer">${r.Label}</a>
              <button class="icon-btn" onclick="App.deleteRow('Brands', ${r._row})"><i class="ti ti-trash"></i></button></li>`).join("") || `<li class="muted small">No assets linked yet.</li>`}</ul>
        </div>`).join("")}</div>
      <div id="modal-root"></div>`;
  },
  wire_brand() {},
  openBrandForm(brand) {
    document.getElementById("modal-root").innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>Add asset link — ${brand}</h3>
          <label>Label<input id="f-label" placeholder="e.g. Logo pack (2026)" /></label>
          <label>Drive / Dropbox link<input id="f-url" /></label>
          <button class="primary-btn full" onclick="App.submitBrand('${brand}')">Add asset</button>
        </div>
      </div>`;
  },
  async submitBrand(brand) {
    const fields = { Brand: brand, Label: document.getElementById("f-label").value, URL: document.getElementById("f-url").value };
    if (!fields.Label.trim() || !fields.URL.trim()) return;
    const { headers } = await this.load("Brands");
    await SheetsAPI.append("Brands", headers, fields);
    document.getElementById("modal-root").innerHTML = "";
    await this.go("brand");
  },

  // ---------------- Team ----------------
  async render_team() {
    const { rows } = await this.load("Users");
    return `
      <h2 class="section-title"><i class="ti ti-users"></i> Team</h2>
      <button class="primary-btn" onclick="App.openTeamForm()"><i class="ti ti-plus"></i> Add member</button>
      <div class="stack">${rows.map(u => `
        <div class="row-card">
          <div>${u.Name} ${u.Email === this.currentUser.Email ? '<span class="tag">You</span>' : ""}</div>
          <div class="row-actions"><span class="tag">${u.Role}</span>
            <button class="icon-btn" onclick="App.deleteRow('Users', ${u._row})"><i class="ti ti-trash"></i></button></div>
        </div>`).join("")}</div>
      <div id="modal-root"></div>`;
  },
  wire_team() {},
  openTeamForm() {
    document.getElementById("modal-root").innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)this.remove()">
        <div class="modal">
          <h3>Add team member</h3>
          <label>Google email (must match their login)<input id="f-email" /></label>
          <label>Name<input id="f-name" /></label>
          <label>Role<select id="f-role">${ROLES.map(r => `<option>${r}</option>`).join("")}</select></label>
          <button class="primary-btn full" onclick="App.submitTeam()">Add member</button>
        </div>
      </div>`;
  },
  async submitTeam() {
    const fields = {
      Email: document.getElementById("f-email").value.trim(),
      Name: document.getElementById("f-name").value.trim(),
      Role: document.getElementById("f-role").value,
    };
    if (!fields.Email || !fields.Name) return;
    const { headers } = await this.load("Users");
    await SheetsAPI.append("Users", headers, fields);
    document.getElementById("modal-root").innerHTML = "";
    alert("Added. Remember: they also need to be added as a Test user in Google Auth Platform → Audience before they can sign in.");
    await this.go("team");
  },
};

document.addEventListener("DOMContentLoaded", () => App.start());

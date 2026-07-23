// Thin wrapper around the Google Sheets v4 REST API.
// Every tab is treated as: row 1 = headers, rows 2+ = data.
// "Delete" is a soft delete (values.clear) so we never need numeric sheet IDs.

const SheetsAPI = {
  base: (path) => `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}${path}`,

  authHeader() {
    const token = Auth.getToken();
    if (!token) throw new Error("Not signed in");
    return { Authorization: `Bearer ${token}` };
  },

  // Reads a tab and returns { headers, rows } where each row is
  // { _row: <sheet row number>, ...fields }
  async list(tab) {
    const res = await fetch(this.base(`/values/${tab}!A:Z`), { headers: this.authHeader() });
    if (!res.ok) throw new Error(`Failed to read ${tab}: ${res.status}`);
    const data = await res.json();
    const values = data.values || [];
    const headers = values[0] || [];
    const rows = values.slice(1).map((row, i) => {
      const obj = { _row: i + 2 };
      headers.forEach((h, idx) => (obj[h] = row[idx] ?? ""));
      return obj;
    }).filter(r => Object.values(r).some(v => v !== "" && v !== r._row));
    return { headers, rows };
  },

  // Appends a new row. `fields` is an object matching the header names.
  async append(tab, headers, fields) {
    const row = headers.map(h => fields[h] ?? "");
    const res = await fetch(
      this.base(`/values/${tab}!A:Z:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`),
      {
        method: "POST",
        headers: { ...this.authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ values: [row] }),
      }
    );
    if (!res.ok) throw new Error(`Failed to append to ${tab}: ${res.status}`);
    return res.json();
  },

  // Overwrites an existing row in place.
  async update(tab, headers, rowNumber, fields) {
    const row = headers.map(h => fields[h] ?? "");
    const res = await fetch(
      this.base(`/values/${tab}!A${rowNumber}:Z${rowNumber}?valueInputOption=USER_ENTERED`),
      {
        method: "PUT",
        headers: { ...this.authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ values: [row] }),
      }
    );
    if (!res.ok) throw new Error(`Failed to update ${tab} row ${rowNumber}: ${res.status}`);
    return res.json();
  },

  // Soft delete: clears the row's contents instead of removing the row,
  // so we never have to look up the tab's numeric sheet ID.
  async remove(tab, rowNumber) {
    const res = await fetch(this.base(`/values/${tab}!A${rowNumber}:Z${rowNumber}:clear`), {
      method: "POST",
      headers: this.authHeader(),
    });
    if (!res.ok) throw new Error(`Failed to delete from ${tab} row ${rowNumber}: ${res.status}`);
    return res.json();
  },
};

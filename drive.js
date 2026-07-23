// Uploads a photo the user picks (from PC or phone) into a Drive folder
// owned by the app (via the drive.file scope), makes it link-viewable,
// and returns a URL usable directly in an <img> tag.

const DriveAPI = {
  async uploadImage(file) {
    const token = Auth.getToken();
    const boundary = "tmupload" + Math.random().toString(36).slice(2);
    const metadata = { name: `${Date.now()}-${file.name}`, mimeType: file.type };

    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${file.type}\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      `${base64Data}\r\n` +
      `--${boundary}--`;

    const uploadRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => "");
      throw new Error(`Drive upload failed (${uploadRes.status}): ${errText}`);
    }
    const uploaded = await uploadRes.json();

    // Make it viewable by anyone with the link, so it can be shown in <img> tags.
    const permRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploaded.id}/permissions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
    if (!permRes.ok) {
      const errText = await permRes.text().catch(() => "");
      throw new Error(`Couldn't set sharing permission (${permRes.status}): ${errText}`);
    }

    return { id: uploaded.id, url: `https://drive.google.com/thumbnail?id=${uploaded.id}&sz=w1000` };
  },
};

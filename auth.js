// Handles Google sign-in using Google Identity Services (GIS).
// Gets an access token scoped for Sheets + Drive, and the signed-in
// user's email/name via the standard userinfo endpoint.

const Auth = {
  tokenClient: null,
  _token: sessionStorage.getItem("tm_token") || null,
  _profile: JSON.parse(sessionStorage.getItem("tm_profile") || "null"),

  init(onSignedIn) {
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: `openid email profile ${CONFIG.SCOPES}`,
      callback: async (resp) => {
        if (resp.error) {
          console.error("Auth error:", resp);
          alert("Sign-in failed. Please try again.");
          return;
        }
        this._token = resp.access_token;
        sessionStorage.setItem("tm_token", this._token);
        await this._loadProfile();
        onSignedIn();
      },
    });

    // If we already have a token this session, just re-check the profile.
    if (this._token && this._profile) {
      onSignedIn();
    }
  },

  signIn() {
    this.tokenClient.requestAccessToken({ prompt: "consent" });
  },

  signOut() {
    if (this._token) {
      google.accounts.oauth2.revoke(this._token, () => {});
    }
    this._token = null;
    this._profile = null;
    sessionStorage.removeItem("tm_token");
    sessionStorage.removeItem("tm_profile");
    location.reload();
  },

  getToken() {
    return this._token;
  },

  getProfile() {
    return this._profile;
  },

  async _loadProfile() {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${this._token}` },
    });
    if (!res.ok) throw new Error("Could not load Google profile");
    const data = await res.json();
    this._profile = { email: data.email, name: data.name || data.email, picture: data.picture || "" };
    sessionStorage.setItem("tm_profile", JSON.stringify(this._profile));
  },
};

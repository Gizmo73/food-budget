/* Sync a JSON snapshot to a private GitHub repo via the contents API.
   The token stays in device settings. It is never written into the snapshot,
   so nothing secret can end up committed. */

const API = "https://api.github.com";

const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const b64decode = (b64) => {
  const binary = atob(String(b64).replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

function check(settings) {
  const missing = ["owner", "repo", "path", "token"].filter((k) => !settings[k]);
  if (missing.length) throw new Error(`Settings incomplete: ${missing.join(", ")}.`);
}

function headers(settings) {
  return {
    Authorization: `Bearer ${settings.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

const fileUrl = (s) =>
  `${API}/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}/contents/${s.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

function explain(status) {
  if (status === 401) return "Token rejected. Check it has not expired.";
  if (status === 403) return "Token lacks Contents write permission on that repo.";
  if (status === 404) return "Repo, branch or path not found. Check the owner and repo names.";
  if (status === 409) return "Branch conflict. Pull first, then push.";
  return `GitHub returned ${status}.`;
}

/* Returns { db, sha } or { db: null, sha: null } when the file does not exist yet. */
export async function pull(settings) {
  check(settings);
  const res = await fetch(`${fileUrl(settings)}?ref=${encodeURIComponent(settings.branch || "main")}`, {
    headers: headers(settings),
    cache: "no-store",
  });
  if (res.status === 404) return { db: null, sha: null };
  if (!res.ok) throw new Error(explain(res.status));
  const meta = await res.json();
  return { db: JSON.parse(b64decode(meta.content)), sha: meta.sha };
}

export async function push(settings, db, message) {
  check(settings);
  let sha = null;
  try {
    const existing = await pull(settings);
    sha = existing.sha;
  } catch (err) {
    if (!/not found/i.test(err.message)) throw err;
  }

  const body = {
    message: message || `Prices updated ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    content: b64encode(JSON.stringify(db, null, 2)),
    branch: settings.branch || "main",
  };
  if (sha) body.sha = sha;

  const res = await fetch(fileUrl(settings), {
    method: "PUT",
    headers: { ...headers(settings), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(explain(res.status));
  const out = await res.json();
  return { sha: out.content && out.content.sha, commit: out.commit && out.commit.sha };
}

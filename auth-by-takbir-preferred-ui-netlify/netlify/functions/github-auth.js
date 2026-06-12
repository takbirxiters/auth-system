exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" }, headers);

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER || "takbirxiters";
  const repo = process.env.GITHUB_REPO || "USER-AND-PASS";
  const path = process.env.GITHUB_FILE || "credentials";
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token) return json(500, { error: "Missing GITHUB_TOKEN environment variable" }, headers);

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }, headers); }

  async function getFile() {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "User-Agent": "auth-by-takbir-netlify",
        "Accept": "application/vnd.github+json"
      }
    });
    if (!res.ok) throw new Error("Failed to fetch credentials");
    const data = await res.json();
    const content = Buffer.from((data.content || "").replace(/\n/g, ""), "base64").toString("utf8");
    return { content, sha: data.sha };
  }

  async function updateFile(newContent, sha) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "User-Agent": "auth-by-takbir-netlify",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Update credentials",
        content: Buffer.from(newContent, "utf8").toString("base64"),
        sha,
        branch
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error("Failed to update credentials: " + txt.slice(0, 140));
    }
  }

  try {
    const { action } = body;
    const file = await getFile();
    const lines = file.content.split(/\r?\n/).map(x => x.trim()).filter(Boolean);

    if (action === "list") {
      const users = lines.map(line => {
        const parts = line.split(":");
        return { username: parts[0] || "", password: parts[1] || "", ip: parts.slice(2).join(":") || "" };
      }).filter(u => u.username);
      return json(200, { users }, headers);
    }

    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    if (!username || !password) return json(400, { error: "Username and password required" }, headers);

    if (action === "create" || action === "createFree") {
      const exists = lines.some(line => line.split(":")[0].trim() === username);
      if (exists) return json(409, { error: "This username already exists" }, headers);

      const third = action === "createFree" ? "Unlimited" : "NONE";
      lines.push(`${username}:${password}:${third}`);
      await updateFile(lines.join("\n") + "\n", file.sha);
      return json(200, { ok: true }, headers);
    }

    if (action === "delete") {
      let found = false;
      const updated = lines.filter(line => {
        const parts = line.split(":");
        const match = (parts[0] || "").trim() === username && (parts[1] || "").trim() === password;
        if (match) found = true;
        return !match;
      });
      if (!found) return json(404, { error: "User not found" }, headers);

      await updateFile(updated.join("\n") + (updated.length ? "\n" : ""), file.sha);
      return json(200, { ok: true }, headers);
    }

    return json(400, { error: "Unknown action" }, headers);
  } catch (e) {
    return json(500, { error: e.message || "Server error" }, headers);
  }
};

function json(statusCode, data, headers) {
  return { statusCode, headers, body: JSON.stringify(data) };
}

export const ONEDRIVE_WORKER_URL = "https://onedrive-proxy.marcinkolacz.workers.dev";
export const ONEDRIVE_SHARED_SECRET_REDACTED = "REDACTED_SECRET";

function authHeaders(extra: Record<string, string> = {}) {
  return { Authorization: "Bearer " + ONEDRIVE_SHARED_SECRET_REDACTED, ...extra };
}

export async function odList(path: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/list?path=" + encodeURIComponent(path), { headers: authHeaders() });
  return resp.json();
}

export async function odCreateFolder(path: string, name: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/createFolder", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ path, name }),
  });
  return resp.json();
}

export async function odUploadSession(path: string, name: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/uploadSession", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ path, name }),
  });
  return resp.json();
}

export async function odPreview(itemId: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/preview?itemId=" + encodeURIComponent(itemId), { headers: authHeaders() });
  return resp.json();
}

export async function odDownloadUrl(itemId: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/downloadUrl?itemId=" + encodeURIComponent(itemId), { headers: authHeaders() });
  return resp.json();
}

export async function odRename(itemId: string, newName: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/rename", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ itemId, newName }),
  });
  return resp.json();
}

export async function odShare(itemId: string, linkType: "edit" | "view" = "edit") {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/share", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ itemId, linkType }),
  });
  return resp.json();
}

export async function odPermissions(itemId: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/permissions?itemId=" + encodeURIComponent(itemId), { headers: authHeaders() });
  return resp.json();
}

export async function odSearch(query: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/search?q=" + encodeURIComponent(query), { headers: authHeaders() });
  return resp.json();
}

export async function odMove(itemId: string, newParentId: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/move", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ itemId, newParentId }),
  });
  return resp.json();
}

export async function odDelete(itemId: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/delete", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ itemId }),
  });
  return resp.json();
}

const UPLOAD_CHUNK_SIZE = 10_485_760;

export async function odUploadFile(path: string, file: File, onProgress?: (pct: number) => void) {
  if (file.size === 0) return;
  const session = await odUploadSession(path, file.name);
  if (!session.uploadUrl) throw new Error("upload_session_failed: " + JSON.stringify(session));
  const total = file.size;
  for (let start = 0; start < total; start += UPLOAD_CHUNK_SIZE) {
    const end = Math.min(start + UPLOAD_CHUNK_SIZE, total) - 1;
    const chunk = file.slice(start, end + 1);
    const resp = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - start + 1),
        "Content-Range": "bytes " + start + "-" + end + "/" + total,
      },
      body: chunk,
    });
    if (!resp.ok) throw new Error("upload_chunk_failed: " + resp.status);
    if (onProgress) onProgress(Math.round(((end + 1) / total) * 100));
  }
}

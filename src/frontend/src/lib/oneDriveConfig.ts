export const ONEDRIVE_WORKER_URL = "https://onedrive-proxy.marcinkolacz.workers.dev";

let registeredActor: any = null;
let cachedToken: string | null = null;
let cachedTokenExpiry = 0;

export function setDriveActor(actor: any) {
  registeredActor = actor;
}

let pendingTokenPromise: Promise<string> | null = null;

async function getDriveToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) {
    console.log("[drive-token] uzyto z cache");
    return cachedToken;
  }
  if (pendingTokenPromise) {
    console.log("[drive-token] czekam na juz trwajace zadanie");
    return pendingTokenPromise;
  }
  if (!registeredActor) throw new Error("Drive actor not registered yet");
  console.time("[drive-token] requestDriveAccessToken");
  const promise: Promise<string> = registeredActor.requestDriveAccessToken().then((token: string) => {
    console.timeEnd("[drive-token] requestDriveAccessToken");
    cachedToken = token;
    cachedTokenExpiry = Date.now() + 4 * 60 * 1000;
    pendingTokenPromise = null;
    return token;
  });
  pendingTokenPromise = promise;
  return promise;
}

async function authHeaders(extra: Record<string, string> = {}) {
  const token = await getDriveToken();
  return { Authorization: "Bearer " + token, ...extra };
}

// --- Public/anonymous variants -------------------------------------
// Used by the public ticket-report form: the caller has no Internet
// Identity session (so no cached staff actor to mint a token from) but
// already holds a short-lived Drive token obtained via
// requestTicketUploadDriveToken(ticketToken). These skip getDriveToken()
// entirely and use that token directly.

export async function odCreateFolderPublic(path: string, name: string, bearerToken: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/createFolder", {
    method: "POST",
    headers: { Authorization: "Bearer " + bearerToken, "Content-Type": "application/json" },
    body: JSON.stringify({ path, name }),
  });
  return resp.json();
}

export async function odListPublic(path: string, bearerToken: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/list?path=" + encodeURIComponent(path), {
    headers: { Authorization: "Bearer " + bearerToken },
  });
  return resp.json();
}

export async function odUploadFilePublic(path: string, file: File, bearerToken: string) {
  if (file.size === 0) return;
  const sessionResp = await fetch(ONEDRIVE_WORKER_URL + "/uploadSession", {
    method: "POST",
    headers: { Authorization: "Bearer " + bearerToken, "Content-Type": "application/json" },
    body: JSON.stringify({ path, name: file.name }),
  });
  const session = await sessionResp.json();
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
  }
  const listing = await odListPublic(path, bearerToken);
  const uploaded = (listing.items || []).find((i: any) => i.name === file.name);
  return uploaded?.id || "";
}


export async function odList(path: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/list?path=" + encodeURIComponent(path), { headers: await authHeaders() });
  return resp.json();
}

export async function odCreateFolder(path: string, name: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/createFolder", {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ path, name }),
  });
  return resp.json();
}

export async function odUploadSession(path: string, name: string, conflictBehavior?: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/uploadSession", {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ path, name, conflictBehavior }),
  });
  return resp.json();
}

export async function odPreview(itemId: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/preview?itemId=" + encodeURIComponent(itemId), { headers: await authHeaders() });
  return resp.json();
}

export async function odDownloadFileBlob(itemId: string): Promise<Blob> {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/downloadFile?itemId=" + encodeURIComponent(itemId), { headers: await authHeaders() });
  if (!resp.ok) throw new Error("Nie udało się pobrać pliku (status " + resp.status + ")");
  return resp.blob();
}

export async function odDownloadUrl(itemId: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/downloadUrl?itemId=" + encodeURIComponent(itemId), { headers: await authHeaders() });
  return resp.json();
}

export async function odRename(itemId: string, newName: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/rename", {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ itemId, newName }),
  });
  return resp.json();
}

export async function odShare(itemId: string, linkType: "edit" | "view" = "edit") {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/share", {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ itemId, linkType }),
  });
  return resp.json();
}

export async function odPermissions(itemId: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/permissions?itemId=" + encodeURIComponent(itemId), { headers: await authHeaders() });
  return resp.json();
}

export async function odSearch(query: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/search?q=" + encodeURIComponent(query), { headers: await authHeaders() });
  return resp.json();
}

export async function odMove(itemId: string, newParentId: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/move", {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ itemId, newParentId }),
  });
  return resp.json();
}

export async function odDelete(itemId: string) {
  const resp = await fetch(ONEDRIVE_WORKER_URL + "/delete", {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ itemId }),
  });
  return resp.json();
}

const UPLOAD_CHUNK_SIZE = 10_485_760;

export async function odUploadFile(path: string, file: File, onProgress?: (pct: number) => void, conflictBehavior?: string) {
  if (file.size === 0) return;
  const session = await odUploadSession(path, file.name, conflictBehavior);
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

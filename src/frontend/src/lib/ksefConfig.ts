export const KSEF_WORKER_URL = "https://ksef-proxy.marcinkolacz.workers.dev";

let registeredActor: any = null;
let cachedToken: string | null = null;
let cachedTokenExpiry = 0;
let pendingTokenPromise: Promise<string> | null = null;

export function setKsefActor(actor: any) {
  registeredActor = actor;
}

async function getAdminToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) return cachedToken;
  if (pendingTokenPromise) return pendingTokenPromise;
  if (!registeredActor) throw new Error("Ksef actor not registered yet");
  const promise: Promise<string> = registeredActor.requestAdminAccessToken().then((token: string) => {
    cachedToken = token;
    cachedTokenExpiry = Date.now() + 4 * 60 * 1000;
    pendingTokenPromise = null;
    return token;
  });
  pendingTokenPromise = promise;
  return promise;
}

async function authHeaders(extra: Record<string, string> = {}) {
  const token = await getAdminToken();
  return { Authorization: "Bearer " + token, ...extra };
}

export async function ksefSetToken(ksefToken: string, nip: string) {
  const resp = await fetch(KSEF_WORKER_URL + "/admin/setToken", {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ksefToken, nip }),
  });
  return resp.json();
}

export async function ksefStatus() {
  const resp = await fetch(KSEF_WORKER_URL + "/admin/status", { headers: await authHeaders() });
  return resp.json();
}

export async function ksefTestAuth() {
  const resp = await fetch(KSEF_WORKER_URL + "/admin/testAuth", {
    method: "POST",
    headers: await authHeaders(),
  });
  return resp.json();
}

export async function ksefListInvoices(from: string, to: string) {
  const resp = await fetch(KSEF_WORKER_URL + "/admin/invoices?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to), {
    headers: await authHeaders(),
  });
  return resp.json();
}

export async function ksefGetInvoiceXml(ksefNumber: string): Promise<string> {
  const resp = await fetch(KSEF_WORKER_URL + "/admin/invoiceXml?ksefNumber=" + encodeURIComponent(ksefNumber), {
    headers: await authHeaders(),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error("Nie udało się pobrać faktury z KSeF (status " + resp.status + "): " + text.slice(0, 300));
  }
  return text;
}

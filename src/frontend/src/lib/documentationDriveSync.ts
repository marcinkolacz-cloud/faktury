import { odList, odCreateFolder, odUploadFile, odDelete, odDownloadUrl, odDownloadFileBlob, odRename } from "./oneDriveConfig";
import { driveTimingReset, driveMark } from "./driveTiming";

const ROOT_FOLDER = "Dokumentacje";

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 120) || "Bez nazwy";
}

// Listing jednego folderu urządzenia jest odpytywany PRZY KAŻDYM otwarciu
// rozdziału (loadChapterContentFromDrive), mimo że w ramach jednej sesji
// zawartość folderu prawie nigdy się nie zmienia między kolejnymi kliknięciami
// w rozdziały - to osobny, sekwencyjny call do Workera/Graph API przed
// właściwym pobraniem treści, więc każde przełączenie rozdziału płaci
// podwójny round-trip. Cache z krótkim TTL + jawna inwalidacja po każdym
// zapisie/zmianie nazwy usuwa ten zbędny odList w typowym przypadku
// (przeglądanie/podgląd wielu rozdziałów tego samego urządzenia pod rząd).
const FOLDER_LIST_TTL_MS = 60_000;
const folderListCache = new Map<string, { items: any[]; expiry: number }>();

async function listFolderCached(path: string): Promise<any[]> {
  const cached = folderListCache.get(path);
  if (cached && Date.now() < cached.expiry) return cached.items;
  // Listing rozdzialow/plikow tekstowych nie potrzebuje miniatur -
  // pomija Graph-side $expand=thumbnails (patrz oneDriveConfig.odList).
  const listing = await odList(path, true);
  const items = listing.items || [];
  folderListCache.set(path, { items, expiry: Date.now() + FOLDER_LIST_TTL_MS });
  return items;
}

function invalidateFolderListCache(path: string): void {
  folderListCache.delete(path);
}

async function ensureFolder(parentPath: string, name: string): Promise<void> {
  const items = await listFolderCached(parentPath);
  const exists = items.some((i: any) => i.name === name && i.folder);
  if (!exists) { await odCreateFolder(parentPath, name); invalidateFolderListCache(parentPath); }
}

// Mirrors one manual chapter to Bartolini Drive as a raw .html file at
// Dokumentacje/{urządzenie}/{numer} - {tytuł} [id].html — called after
// every explicit save/rename so the Drive copy always matches what's in
// the editor. The "[id]" suffix is a stable tag (chapter id never
// changes) used to find and replace the OLD file when the title or order
// changes, so renaming never leaves an orphaned duplicate behind.
export async function loadChapterContentFromDrive(deviceLabel: string, chapterId: number): Promise<string> {
  driveTimingReset();
  const deviceFolder = sanitizeName(deviceLabel);
  const folderPath = `${ROOT_FOLDER}/${deviceFolder}`;
  const idTag = `[${chapterId}]`;
  const items = await listFolderCached(folderPath);
  driveMark("list");
  const match = items.find((i: any) => typeof i.name === "string" && i.name.includes(idTag));
  if (!match) return "";
  const blob = await odDownloadFileBlob(match.id);
  driveMark("download");
  const text = await blob.text();
  driveMark("text");
  return text;
}

export async function syncChapterToDrive(
  deviceLabel: string,
  chapterId: number,
  order: number,
  title: string,
  contentHtml: string,
): Promise<void> {
  const deviceFolder = sanitizeName(deviceLabel);
  await ensureFolder("", ROOT_FOLDER);
  await ensureFolder(ROOT_FOLDER, deviceFolder);
  const folderPath = `${ROOT_FOLDER}/${deviceFolder}`;

  const idTag = `[${chapterId}]`;
  const fileName = `${String(order + 1).padStart(2, "0")} - ${sanitizeName(title)} ${idTag}.html`;

  const items = await listFolderCached(folderPath);
  const stale = items.filter((i: any) => typeof i.name === "string" && i.name.includes(idTag) && i.name !== fileName);

  // Upload PIERWSZY, dopiero potem kasujemy stary plik pod inną nazwą —
  // jeśli upload padnie w trakcie (np. zerwane łącze), stary plik nadal
  // istnieje i treść nie ginie. Odwrotna kolejność (delete→upload)
  // ryzykowała całkowitą utratę treści przy błędzie w trakcie uploadu.
  const blob = new Blob([contentHtml], { type: "text/html" });
  const file = new File([blob], fileName, { type: "text/html" });
  await odUploadFile(folderPath, file, undefined, "replace");

  for (const item of stale) {
    try { await odDelete(item.id); } catch { /* best-effort cleanup */ }
  }
  invalidateFolderListCache(folderPath);
}

// Renames the chapter's Drive file WITHOUT touching its content - used by
// confirmRename(), which (post-migration) never has the real contentHtml
// available for a chapter that isn't the currently-open one (the sidebar
// list only carries metadata; content lives in the editor / on Drive).
// Calling syncChapterToDrive() for a plain rename would re-upload with an
// empty/stale contentHtml and silently wipe the chapter's real content.
export async function renameChapterOnDrive(
  deviceLabel: string,
  chapterId: number,
  order: number,
  title: string,
): Promise<void> {
  const deviceFolder = sanitizeName(deviceLabel);
  const folderPath = `${ROOT_FOLDER}/${deviceFolder}`;
  const idTag = `[${chapterId}]`;
  const newFileName = `${String(order + 1).padStart(2, "0")} - ${sanitizeName(title)} ${idTag}.html`;

  const items = await listFolderCached(folderPath);
  const existing = items.find((i: any) => typeof i.name === "string" && i.name.includes(idTag));
  if (!existing) return; // chapter never synced to Drive yet - nothing to rename
  if (existing.name === newFileName) return;
  await odRename(existing.id, newFileName);
  invalidateFolderListCache(folderPath);
}

async function nextImageNumber(imagesFolderPath: string): Promise<number> {
  const listing = await odList(imagesFolderPath);
  const items = listing.items || [];
  let max = 0;
  for (const it of items) {
    const m = /^(\d+)\./.exec(it.name || "");
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

// Uploads one embedded image to Dokumentacje/{urządzenie}/images/{n}.ext
// (sequential numbering, 1 upward, per device — never resets) and returns
// a durable "view" share link. The editor stores THIS URL in the <img
// src>, never the raw image bytes — keeps the saved HTML small and
// readable instead of bloated with base64 data, and the image genuinely
// lives on Bartolini Drive as its source of truth.
// Obrazki na Drive znikały po ~1h, bo @microsoft.graph.downloadUrl (link
// tymczasowy) był zapisywany w treści na stałe jako <img src>. Teraz
// uploadChapterImage zwraca DODATKOWO itemId (edytor zapisuje go w
// data-drive-item-id, patrz AlignableImage), a resolveDriveImages()
// poniżej podmienia src na świeży, uwierzytelniony blob: URL tuż przed
// wyświetleniem/eksportem - nigdy przy zapisie, żeby na Drive zawsze
// zostawał stabilny wpis z itemId, a nie wygasający blob:.
export async function resolveDriveImages(html: string): Promise<string> {
  if (!html || !html.includes("data-drive-item-id")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = Array.from(doc.querySelectorAll("img[data-drive-item-id]"));
  await Promise.all(
    imgs.map(async (img) => {
      const itemId = img.getAttribute("data-drive-item-id");
      if (!itemId) return;
      try {
        const blob = await odDownloadFileBlob(itemId);
        img.setAttribute("src", URL.createObjectURL(blob));
      } catch {
        // brak dostepu do obrazka na Drive - zostaw stary/martwy src
      }
    }),
  );
  return doc.body.innerHTML;
}

export async function uploadChapterImage(deviceLabel: string, blob: Blob, extension: string): Promise<{ url: string; itemId: string }> {
  const deviceFolder = sanitizeName(deviceLabel);
  await ensureFolder("", ROOT_FOLDER);
  await ensureFolder(ROOT_FOLDER, deviceFolder);
  const devicePath = `${ROOT_FOLDER}/${deviceFolder}`;
  await ensureFolder(devicePath, "images");
  const imagesPath = `${devicePath}/images`;

  let number = await nextImageNumber(imagesPath);
  let lastError: any = null;

  // OneDrive's folder listing can lag a moment behind reality (right
  // after a folder is created, or right after a previous upload), so
  // nextImageNumber() can occasionally suggest a number that's actually
  // already taken. Rather than fail outright on that specific conflict,
  // just try the next number — up to a generous handful of attempts.
  for (let attempt = 0; attempt < 8; attempt++) {
    const fileName = `${number}.${extension}`;
    const file = new File([blob], fileName, { type: blob.type });
    try {
      await odUploadFile(imagesPath, file);
      const listing = await odList(imagesPath);
      const uploaded = (listing.items || []).find((i: any) => i.name === fileName);
      if (!uploaded?.id) throw new Error("Nie znaleziono przesłanego obrazka po wgraniu na Drive.");
      // Was odShare(...) — that endpoint requires the "admin" role and returns
      // a link to the OneDrive web page for the file (not usable as <img src>).
      // odDownloadUrl requires only "read" and returns the file's direct
      // content URL (@microsoft.graph.downloadUrl), which renders correctly.
      let shareResult = await odDownloadUrl(uploaded.id);
      if (!shareResult.downloadUrl) {
        // Occasionally the item isn't fully "settled" server-side the
        // instant after upload — one short retry covers that without
        // adding real delay to the common case.
        await new Promise((r) => setTimeout(r, 1200));
        shareResult = await odDownloadUrl(uploaded.id);
      }
      if (!shareResult.downloadUrl) {
        throw new Error("Nie udało się utworzyć linku do obrazka na Drive: " + JSON.stringify(shareResult));
      }
      return { url: shareResult.downloadUrl, itemId: uploaded.id };
    } catch (e: any) {
      lastError = e;
      const msg = String(e?.message || e);
      if (msg.includes("nameAlreadyExists")) {
        number += 1;
        continue;
      }
      throw e; // a different failure — don't hide it behind retries
    }
  }
  throw lastError || new Error("Nie udało się wgrać obrazka po kilku próbach.");
}

const IMAGE_UPLOAD_CHUNK_SIZE = 1_500_000;

// Wysyła obraz (Blob) do magazynu obrazków backupu dokumentacji na
// kanistrze (deviceManualImages), chunkowany zapis identyczny wzorem co
// beginChapterUpload/appendChapterChunk. Zwraca id obrazka do wstawienia
// w URL https://<canister>.raw.icp0.io/manualImage/<id>.
export async function uploadImageToCanister(actor: any, blob: Blob, contentType: string): Promise<string> {
  const id: string = await actor.beginManualImageUpload();
  const buf = new Uint8Array(await blob.arrayBuffer());
  for (let start = 0; start < buf.length; start += IMAGE_UPLOAD_CHUNK_SIZE) {
    const chunk = buf.slice(start, start + IMAGE_UPLOAD_CHUNK_SIZE);
    await actor.appendManualImageChunk(id, chunk);
  }
  await actor.commitManualImageUpload(id, contentType);
  return id;
}

const BACKUP_IMAGE_MAX_DIM = 1600;
const BACKUP_IMAGE_HARD_LIMIT_BYTES = 400_000;
const BACKUP_IMAGE_QUALITY_STEPS = [0.75, 0.6, 0.5, 0.4, 0.3];

// Kompresuje obraz z OneDrive do JPEG przed uploadem na kanister -
// zmniejsza dłuższy bok do BACKUP_IMAGE_MAX_DIM, potem obniża jakość wg
// BACKUP_IMAGE_QUALITY_STEPS aż zmieści się w limicie lub wyczerpie kroki.
export async function compressImageForBackup(sourceBlob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(sourceBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, BACKUP_IMAGE_MAX_DIM / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no ctx");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let last: Blob | null = null;
    for (const quality of BACKUP_IMAGE_QUALITY_STEPS) {
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) continue;
      last = blob;
      if (blob.size <= BACKUP_IMAGE_HARD_LIMIT_BYTES) return blob;
    }
    if (!last) throw new Error("compression failed");
    return last;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Przechodzi po img[data-drive-item-id] w HTML kopii backupu, pobiera
// oryginał z OneDrive, kompresuje (compressImageForBackup) i wgrywa na
// kanister (uploadImageToCanister), podmieniając src na URL kanistra i
// zamieniając atrybut na data-canister-image-id (sekwencyjnie, nie
// równolegle - patrz uzasadnienie w uploadImageToCanister/ManualImage
// backend). Zwraca nowy HTML.
export async function migrateImagesToCanisterBackup(
  html: string,
  actor: any,
  canisterBaseUrl: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  if (!html || !html.includes("data-drive-item-id")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = Array.from(doc.querySelectorAll("img[data-drive-item-id]"));
  let done = 0;
  for (const img of imgs) {
    const itemId = img.getAttribute("data-drive-item-id");
    if (!itemId) { done++; continue; }
    try {
      const original = await odDownloadFileBlob(itemId);
      const compressed = await compressImageForBackup(original);
      const id = await uploadImageToCanister(actor, compressed, "image/jpeg");
      img.setAttribute("src", `${canisterBaseUrl}/manualImage/${id}`);
      img.setAttribute("data-canister-image-id", id);
      img.removeAttribute("data-drive-item-id");
    } catch {
      // pojedynczy obrazek nie przeszedł - zostaw jak jest, nie przerywaj całości
    } finally {
      done++;
      onProgress?.(done, imgs.length);
    }
  }
  return doc.body.innerHTML;
}

// Zbiera wszystkie data-canister-image-id obecne w danym HTML (do
// porównania starej/nowej wersji backupu przy sprzątaniu nieużywanych
// obrazków po nadpisaniu kopii).
export function collectCanisterImageIds(html: string): Set<string> {
  const ids = new Set<string>();
  if (!html) return ids;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("img[data-canister-image-id]").forEach((img) => {
    const id = img.getAttribute("data-canister-image-id");
    if (id) ids.add(id);
  });
  return ids;
}

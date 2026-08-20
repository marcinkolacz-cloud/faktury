import { odList, odCreateFolder, odUploadFile, odDelete, odDownloadUrl } from "./oneDriveConfig";

const ROOT_FOLDER = "Dokumentacje";

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 120) || "Bez nazwy";
}

async function ensureFolder(parentPath: string, name: string): Promise<void> {
  const listing = await odList(parentPath);
  const exists = (listing.items || []).some((i: any) => i.name === name && i.folder);
  if (!exists) await odCreateFolder(parentPath, name);
}

// Mirrors one manual chapter to Bartolini Drive as a raw .html file at
// Dokumentacje/{urządzenie}/{numer} - {tytuł} [id].html — called after
// every explicit save/rename so the Drive copy always matches what's in
// the editor. The "[id]" suffix is a stable tag (chapter id never
// changes) used to find and replace the OLD file when the title or order
// changes, so renaming never leaves an orphaned duplicate behind.
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

  const listing = await odList(folderPath);
  const items = listing.items || [];
  const stale = items.filter((i: any) => typeof i.name === "string" && i.name.includes(idTag) && i.name !== fileName);
  for (const item of stale) {
    try { await odDelete(item.id); } catch { /* best-effort cleanup */ }
  }

  const blob = new Blob([contentHtml], { type: "text/html" });
  const file = new File([blob], fileName, { type: "text/html" });
  await odUploadFile(folderPath, file, undefined, "replace");
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
export async function uploadChapterImage(deviceLabel: string, blob: Blob, extension: string): Promise<string> {
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
      return shareResult.downloadUrl;
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

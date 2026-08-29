import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

if 'import { driveTimingReset, driveMark } from "./driveTiming";' not in src:
    lines = src.split("\n")
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith("import "):
            insert_at = i + 1
        elif insert_at > 0:
            break
    lines.insert(insert_at, 'import { driveTimingReset, driveMark } from "./driveTiming";')
    src = "\n".join(lines)

old = '''export async function loadChapterContentFromDrive(deviceLabel: string, chapterId: number): Promise<string> {
  const deviceFolder = sanitizeName(deviceLabel);
  const folderPath = `${ROOT_FOLDER}/${deviceFolder}`;
  const idTag = `[${chapterId}]`;
  const items = await listFolderCached(folderPath);
  const match = items.find((i: any) => typeof i.name === "string" && i.name.includes(idTag));
  if (!match) return "";
  const blob = await odDownloadFileBlob(match.id);
  return await blob.text();
}'''
new = '''export async function loadChapterContentFromDrive(deviceLabel: string, chapterId: number): Promise<string> {
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
}'''
assert old in src, "marker loadChapterContentFromDrive nie znaleziony - plik zmienil sie od podgladu"
src = src.replace(old, new, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK - patched", path)

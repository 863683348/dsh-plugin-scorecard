import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import crypto from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://registry.npmjs.org";
const TO = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadToken() {
  if (process.env.NPM_TOKEN) return process.env.NPM_TOKEN.trim();
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE, ".dsh");
  const p = join(home, "secrets", "npm-token.txt");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  throw new Error("npm token missing");
}

function tar(files) {
  const blocks = [];
  const pad = (buf, size) => { const out = Buffer.alloc(size); buf.copy(out); return out; };
  for (const { name, data } of files) {
    const content = Buffer.from(data);
    const header = Buffer.alloc(512);
    const write = (off, len, str) => header.write(str, off, len, "utf8");
    write(0, 100, name);
    write(100, 8, "644");
    write(108, 8, "0");
    write(116, 8, "0");
    write(124, 12, content.length.toString(8));
    write(136, 12, Math.floor(Date.now() / 1000).toString(8));
    write(148, 8, "0");
    header[156] = 0x30;
    write(257, 6, "ustar");
    write(263, 2, "00");
    for (let i = 148; i < 156; i++) header[i] = 0x20;
    let sum = 0;
    for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
    blocks.push(header);
    if (content.length) blocks.push(pad(content, Math.ceil(content.length / 512) * 512));
  }
  blocks.push(Buffer.alloc(512), Buffer.alloc(512));
  return Buffer.concat(blocks);
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const name = pkg.name, version = pkg.version;
const readme = existsSync(join(ROOT, "README.md")) ? readFileSync(join(ROOT, "README.md"), "utf8") : "";
const libFiles = ["catalog.js", "format.js", "index.js", "scorer.js"]
  .filter((f) => existsSync(join(ROOT, "lib", f)))
  .map((f) => ({ name: "lib/" + f, data: readFileSync(join(ROOT, "lib", f)) }));
const files = [
  { name: "package.json", data: JSON.stringify(pkg, null, 2) },
  { name: "README.md", data: readme },
  { name: "cordis.patch.yml", data: readFileSync(join(ROOT, "cordis.patch.yml"), "utf8") },
  ...libFiles,
];
const tarball = zlib.gzipSync(tar(files), { level: 9 });
const shasum = crypto.createHash("sha1").update(tarball).digest("hex");
const integrity = "sha512-" + crypto.createHash("sha512").update(tarball).digest("base64");
const tarballName = name + "-" + version + ".tgz";
const versionDoc = {
  _id: name + "@" + version, name, version, description: pkg.description,
  main: pkg.main, type: pkg.type, license: pkg.license, files: pkg.files,
  scripts: pkg.scripts, publishConfig: pkg.publishConfig, dsh: pkg.dsh,
  peerDependencies: pkg.peerDependencies,
  dist: { integrity, shasum, tarball: REGISTRY + "/" + name + "/-" + tarballName },
};
const doc = {
  _id: name, name, description: pkg.description,
  "dist-tags": { latest: version },
  versions: { [version]: versionDoc }, readme,
  _attachments: { [tarballName]: { content_type: "application/octet-stream", data: tarball.toString("base64"), length: tarball.length } },
};
const token = loadToken();
console.log("pkg=" + name + "@" + version);

for (let attempt = 1; attempt <= 6; attempt++) {
  console.log("--- attempt " + attempt + " ---");
  const put = await fetch(REGISTRY + "/" + encodeURIComponent(name), {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "User-Agent": "dsh-plugin-scorecard/publish-v3" },
    body: JSON.stringify(doc),
    signal: AbortSignal.timeout(60000),
  });
  const body = await put.text();
  const retryAfter = put.headers.get("retry-after");
  console.log("status=" + put.status + " retry-after=" + retryAfter + " rate-remaining=" + put.headers.get("x-ratelimit-remaining"));
  console.log("body=" + body.slice(0, 400));
  if (put.ok) { console.log("PUBLISHED https://www.npmjs.com/package/" + name); process.exit(0); }
  if (put.status !== 429 && put.status !== 408 && put.status < 500) { process.exit(1); }
  const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : 25000;
  console.log("waiting " + (wait / 1000) + "s...");
  await sleep(Math.min(wait, 45000));
}
console.log("GAVE UP after 6 attempts");
process.exit(1);

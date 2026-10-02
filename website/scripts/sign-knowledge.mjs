import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALLOWED = [
  "catalog.json",
  "search-index.json",
  "pack/handbook.json",
  "pack/topics.json",
  "pack/master.json",
  "pack/epki.json",
];

const dir = process.argv[2];
const keyPath = process.env.KNOWLEDGE_SIGNING_KEY_PATH || process.argv[3];
if (!dir || !keyPath) {
  console.error("서명 키가 없습니다.");
  process.exit(1);
}

let pem;
try {
  pem = fs.readFileSync(keyPath);
} catch {
  console.error("서명 키를 읽지 않았습니다.");
  process.exit(1);
}

const files = [];
for (const name of ALLOWED) {
  const full = path.join(dir, name);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    continue;
  }
  const body = fs.readFileSync(full);
  files.push({
    path: name,
    size: body.length,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  });
}

const manifest = Buffer.from(
  JSON.stringify({
    format: 1,
    serial: Math.floor(Date.now() / 1000),
    generatedAt: new Date().toISOString(),
    files,
  }),
);

let signature;
try {
  signature = crypto.sign("sha256", manifest, { key: pem, dsaEncoding: "ieee-p1363" });
} catch {
  console.error("서명에 실패했습니다.");
  process.exit(1);
}
if (signature.length !== 64) {
  console.error("서명에 실패했습니다.");
  process.exit(1);
}

fs.writeFileSync(path.join(dir, "manifest.json"), manifest);
fs.writeFileSync(path.join(dir, "manifest.json.sig"), signature.toString("base64"));
console.log(`서명 완료 ${files.length}`);

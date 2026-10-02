import crypto from "node:crypto";
import fs from "node:fs";

const keyPath = process.env.KNOWLEDGE_SIGNING_KEY_PATH || process.argv[2];
if (!keyPath) {
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

let point;
try {
  const jwk = crypto.createPublicKey(pem).export({ format: "jwk" });
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  if (x.length !== 32 || y.length !== 32) {
    throw new Error("size");
  }
  point = Buffer.concat([Buffer.from([0x04]), x, y]);
} catch {
  console.error("공개키를 만들지 못했습니다.");
  process.exit(1);
}

console.log(point.toString("base64"));

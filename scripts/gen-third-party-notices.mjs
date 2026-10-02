// 배포본 오픈소스 고지. Node 내장 모듈만 사용한다.
// license 필드의 "A/B"는 Cargo의 옛 관용 표기이며 "A OR B"로 해석한다.
// 승인 예외는 이름과 버전을 함께 비교한다. 버전이 바뀌면 다시 경고한다.
const APPROVED_EXCEPTIONS = [
  { name: "cssparser", version: "0.36.0", license: "MPL-2.0", reason: "Tauri 기본 의존성, 수정 없이 사용" },
  { name: "selectors", version: "0.36.1", license: "MPL-2.0", reason: "Tauri 기본 의존성, 수정 없이 사용" },
  { name: "dtoa-short", version: "0.3.5", license: "MPL-2.0", reason: "Tauri 기본 의존성, 수정 없이 사용" },
  { name: "option-ext", version: "0.2.0", license: "MPL-2.0", reason: "Tauri 기본 의존성, 수정 없이 사용" },
  { name: "unic-ucd-ident", version: "0.9.0", license: "MIT/Apache-2.0", reason: "라이선스 파일 없음. 소스 주석의 MIT 또는 Apache-2.0 표기를 따름" },
  { name: "unic-ucd-version", version: "0.9.0", license: "MIT/Apache-2.0", reason: "라이선스 파일 없음. 소스 주석의 MIT 또는 Apache-2.0 표기를 따름" },
  { name: "unic-common", version: "0.9.0", license: "MIT/Apache-2.0", reason: "라이선스 파일 없음. 소스 주석의 MIT 또는 Apache-2.0 표기를 따름" },
  { name: "unic-char-property", version: "0.9.0", license: "MIT/Apache-2.0", reason: "라이선스 파일 없음. 소스 주석의 MIT 또는 Apache-2.0 표기를 따름" },
  { name: "unic-char-range", version: "0.9.0", license: "MIT/Apache-2.0", reason: "라이선스 파일 없음. 소스 주석의 MIT 또는 Apache-2.0 표기를 따름" },
];

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const reportOnly = args.includes("--report");
const siteOnly = args.includes("--site");
const metaFlag = args.indexOf("--metadata");
const metadataArg = metaFlag >= 0 ? args[metaFlag + 1] : "";

const NOTICE_OK = new Set([
  "MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib",
  "Unicode-3.0", "Unicode-DFS-2016", "BSL-1.0",
]);
const NO_NOTICE = new Set(["CC0-1.0", "0BSD", "Unlicense", "Public Domain"]);
const PREFER = [
  "MIT", "MIT-0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Apache-2.0",
  "BSL-1.0", "Unicode-3.0", "Unicode-DFS-2016", "CC0-1.0", "0BSD", "Unlicense",
];

function bucketOf(id) {
  const base = id.replace(/-only$/, "").replace(/-or-later$/, "");
  if (NOTICE_OK.has(id) || NOTICE_OK.has(base)) return "허용-고지";
  if (NO_NOTICE.has(id)) return "허용-고지불필요";
  if (/^(MPL-|LGPL-|EPL-|CDDL-)/.test(id) || /^(MPL|LGPL|EPL|CDDL)/.test(base)) return "조건부";
  if (/GPL|AGPL|SSPL|BUSL|Commons-Clause|PolyForm/.test(id)) return "금지";
  return "판단불가";
}

function splitTop(expr, sep) {
  const parts = [];
  let depth = 0;
  let cur = "";
  const token = ` ${sep} `;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (depth === 0 && expr.slice(i, i + token.length) === token) {
      parts.push(cur.trim());
      cur = "";
      i += token.length - 1;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function unwrap(value) {
  const text = value.trim();
  if (!text.startsWith("(") || !text.endsWith(")")) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") depth -= 1;
    if (depth === 0 && i < text.length - 1) return text;
  }
  return unwrap(text.slice(1, -1));
}

function asSpdx(expr) {
  const text = String(expr).replace(/\s+/g, " ").trim();
  if (/\bAND\b|\bOR\b|\bWITH\b/.test(text) || !text.includes("/")) return { text, slash: false };
  const parts = text.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every((part) => /^[A-Za-z0-9.+-]+$/.test(part))) {
    return { text: parts.join(" OR "), slash: true };
  }
  return { text, slash: false };
}

function classify(expr) {
  if (!expr || !String(expr).trim()) {
    return { bucket: "판단불가", chosen: [], raw: "", reason: "license 필드 없음", slash: false };
  }
  const parsed = asSpdx(expr);
  const text = parsed.text;
  const andParts = splitTop(text, "AND").map(unwrap);
  const chosen = [];
  const reasons = [];
  let worst = "허용-고지불필요";
  const rank = { "허용-고지불필요": 0, "허용-고지": 1, "조건부": 2, "판단불가": 3, "금지": 4 };
  for (const part of andParts) {
    const ors = splitTop(part, "OR").map(unwrap);
    const scored = ors.map((item) => {
      const id = item.replace(/ WITH .+$/, "").trim();
      return { id, bucket: bucketOf(id) };
    });
    if (ors.length > 1) {
      const mit = scored.find((item) => item.id === "MIT" && (item.bucket === "허용-고지" || item.bucket === "허용-고지불필요"));
      const allowed = scored.filter((item) => item.bucket === "허용-고지" || item.bucket === "허용-고지불필요");
      if (mit) {
        chosen.push(mit.id);
        if (rank[mit.bucket] > rank[worst]) worst = mit.bucket;
        reasons.push(`${part} 중 MIT 선택`);
        continue;
      }
      if (allowed.length) {
        allowed.sort((a, b) => PREFER.indexOf(a.id) - PREFER.indexOf(b.id));
        const pick = allowed[0];
        chosen.push(pick.id);
        if (rank[pick.bucket] > rank[worst]) worst = pick.bucket;
        reasons.push(`${part} 중 ${pick.id} 선택`);
        continue;
      }
    }
    const only = scored[0];
    chosen.push(only.id);
    if (rank[only.bucket] > rank[worst]) worst = only.bucket;
    if (only.bucket === "판단불가") reasons.push(`${only.id}는 분류표 밖`);
  }
  if (parsed.slash) reasons.push("Cargo 옛 표기 A/B를 A OR B로 해석");
  return { bucket: worst, chosen, raw: text, reason: reasons.join("; "), slash: parsed.slash };
}

function loadMetadata() {
  if (metadataArg) {
    return JSON.parse(fs.readFileSync(metadataArg, "utf8"));
  }
  try {
    const raw = execFileSync(
      "cargo",
      ["metadata", "--format-version", "1", "--filter-platform", "x86_64-pc-windows-msvc", "--offline", "--locked"],
      { cwd: path.join(root, "src-tauri"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(raw);
  } catch (error) {
    const fallback = "C:\\Temp\\cargo-metadata.json";
    if (fs.existsSync(fallback)) return JSON.parse(fs.readFileSync(fallback, "utf8"));
    console.error("cargo metadata를 실행하지 못했고 C:\\Temp\\cargo-metadata.json도 없습니다.");
    console.error(String(error.stderr || error.message || error).slice(0, 500));
    process.exit(3);
  }
}

function isMacro(pkg) {
  return (pkg.targets || []).some((target) =>
    (target.crate_types || []).includes("proc-macro") || (target.kind || []).includes("proc-macro"));
}

const unknownTargets = new Set();
const FACTS = { windows: true, unix: false, windows_raw_dylib: false, tokio_unstable: false };

function splitArgs(text) {
  const args = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

function evalAtom(atom) {
  const text = atom.trim();
  const eq = text.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"$/);
  if (eq) {
    const [, key, value] = eq;
    if (key === "target_os") return value === "windows";
    if (key === "target_arch") return value === "x86_64";
    if (key === "target_env") return value === "msvc";
    if (key === "target_family") return value === "windows";
    if (key === "target_endian") return value === "little";
    if (key === "target_pointer_width") return value === "64";
    if (key === "target_feature") return false;
    return null;
  }
  if (/^[A-Za-z0-9_]+$/.test(text)) return Object.prototype.hasOwnProperty.call(FACTS, text) ? FACTS[text] : null;
  return null;
}

function evalExpr(text) {
  const body = text.trim();
  const call = body.match(/^(cfg|any|all|not)\(([\s\S]*)\)$/);
  if (call) {
    const [, fn, inner] = call;
    if (fn === "cfg") return evalExpr(inner);
    const args = splitArgs(inner);
    if (fn === "not") {
      const value = evalExpr(args[0] || "");
      return value == null ? null : !value;
    }
    if (fn === "any") {
      let unknown = false;
      for (const arg of args) {
        const value = evalExpr(arg);
        if (value === true) return true;
        if (value == null) unknown = true;
      }
      return unknown ? null : false;
    }
    let unknown = false;
    for (const arg of args) {
      const value = evalExpr(arg);
      if (value === false) return false;
      if (value == null) unknown = true;
    }
    return unknown ? null : true;
  }
  return evalAtom(body);
}

function activeTarget(target) {
  if (target == null || target === "") return true;
  const value = evalExpr(String(target));
  if (value == null) {
    unknownTargets.add(String(target));
    return true;
  }
  return value;
}

function runtimeEdge(kind) {
  return (kind.kind == null || kind.kind === "normal") && activeTarget(kind.target);
}

function buildEdge(kind) {
  return kind.kind === "build" && activeTarget(kind.target);
}

function listFiles(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => /^(license|licence|copying|notice)/i.test(name) && !/\.spdx$/i.test(name))
    .map((name) => path.join(dir, name));
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
}

function legacyCopyrightLine(line) {
  return /copyright\s+(?:\d|\(c\)|©)|©\s*\d{4}/i.test(line);
}

function isCopyrightLine(line) {
  const text = line.trim().replace(/^(?:\/\/+|\/?\*+)\s*/, "");
  if (/^©\s*\d{4}/.test(text) || /^\(c\)\s*\d{4}/i.test(text)) return true;
  return /^copyright\s+(?:\(c\)|©|\d{4}(?:\s*-\s*\d{4})?|\S)/i.test(text);
}

function linesMatching(text, test) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && test(line)).slice(0, 12);
}

function copyrightLines(text) {
  return linesMatching(text, isCopyrightLine);
}

function graphOf(meta) {
  const packages = new Map(meta.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(meta.resolve.nodes.map((node) => [node.id, node]));
  const rootId = meta.resolve.root;
  const role = new Map();
  const via = new Map();
  const rank = { dev: 1, build: 2, runtime: 3 };

  function walk(id, mode, direct) {
    const pkg = packages.get(id);
    const node = nodes.get(id);
    if (!pkg || !node || id === rootId) return;
    const next = mode === "runtime" && isMacro(pkg) ? "build" : mode;
    const prev = role.get(id);
    if (!via.has(id)) via.set(id, new Set());
    if (direct) via.get(id).add(direct);
    if (prev && rank[prev] > rank[next]) return;
    if (prev === next) return;
    role.set(id, next);
    for (const dep of node.deps || []) {
      for (const kind of dep.dep_kinds || []) {
        if (next === "runtime") {
          if (runtimeEdge(kind)) walk(dep.pkg, "runtime", direct);
          else if (buildEdge(kind)) walk(dep.pkg, "build", direct);
        } else if (next === "build" || next === "dev") {
          if (runtimeEdge(kind) || buildEdge(kind)) walk(dep.pkg, next, direct);
        }
      }
    }
  }

  const rootNode = nodes.get(rootId);
  for (const dep of rootNode?.deps || []) {
    for (const kind of dep.dep_kinds || []) {
      if (runtimeEdge(kind)) walk(dep.pkg, "runtime", dep.name);
      else if (buildEdge(kind)) walk(dep.pkg, "build", dep.name);
      else if (kind.kind === "dev" && activeTarget(kind.target)) walk(dep.pkg, "dev", dep.name);
    }
  }
  return { packages, role, via };
}

function refine(pkg, cls, files) {
  if (pkg.license && cls.bucket !== "판단불가") return cls;
  const blob = files.map(readText).join("\n").slice(0, 8000);
  const hasMit = /Permission is hereby granted, free of charge/i.test(blob);
  const hasApache = /Apache License[\s\S]{0,80}Version 2\.0/i.test(blob);
  const basis = pkg.license ? `license 필드 "${pkg.license}"는 SPDX가 아님` : "license 필드 없음";
  if (hasMit) {
    return { bucket: "허용-고지", chosen: ["MIT"], raw: pkg.license || "", reason: `${basis}. LICENSE 문구로 MIT 판단` };
  }
  if (hasApache) {
    return { bucket: "허용-고지", chosen: ["Apache-2.0"], raw: pkg.license || "", reason: `${basis}. LICENSE 문구로 Apache-2.0 판단` };
  }
  if (/Redistribution and use in source and binary forms/i.test(blob)) {
    return { bucket: "허용-고지", chosen: ["BSD-3-Clause"], raw: pkg.license || "", reason: `${basis}. LICENSE 문구로 BSD 판단` };
  }
  if (/This is free and unencumbered software released into the public domain/i.test(blob)) {
    return { bucket: "허용-고지불필요", chosen: ["Unlicense"], raw: pkg.license || "", reason: `${basis}. LICENSE 문구로 Unlicense 판단` };
  }
  return cls;
}

function chosenFile(files, chosen) {
  const textOf = files.map((file) => ({ file, text: readText(file) }));
  for (const id of chosen) {
    if (id === "MIT") {
      const hit = textOf.find((item) => /mit/i.test(path.basename(item.file)) && /Permission is hereby granted/i.test(item.text));
      if (hit) return hit;
      const plain = textOf.find((item) => /Permission is hereby granted/i.test(item.text));
      if (plain) return plain;
    }
    if (id.startsWith("Apache")) {
      const hit = textOf.find((item) => /apache/i.test(path.basename(item.file)));
      if (hit) return hit;
    }
    if (id.startsWith("BSD")) {
      const hit = textOf.find((item) => /bsd/i.test(path.basename(item.file)) || /Redistribution and use/i.test(item.text));
      if (hit) return hit;
    }
    if (id === "ISC") {
      const hit = textOf.find((item) => /ISC/i.test(item.text) || /Permission to use, copy, modify, and\/or distribute/i.test(item.text));
      if (hit) return hit;
    }
  }
  return textOf[0] || null;
}

function findNodeModule(start, name) {
  const parts = name.split("/");
  let dir = start;
  while (dir) {
    const candidate = path.join(dir, "node_modules", ...parts);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return "";
    dir = parent;
  }
  return "";
}

function lockPackages(start) {
  const lockPath = path.join(start, "package-lock.json");
  if (!fs.existsSync(lockPath)) return new Map();
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const map = new Map();
  for (const [key, node] of Object.entries(lock.packages || {})) {
    if (!key.startsWith("node_modules/") || key.slice("node_modules/".length).includes("node_modules/")) continue;
    const name = key.slice("node_modules/".length);
    if (!map.has(name)) map.set(name, node);
  }
  return map;
}

function npmPackages(start) {
  const run = spawnSync("npm", ["ls", "--omit=dev", "--all", "--json"], {
    cwd: start,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (!run.stdout) {
    console.error(String(run.error || run.stderr || "npm ls 실패").slice(0, 500));
    process.exit(3);
  }
  const tree = JSON.parse(run.stdout);
  const rootPkg = JSON.parse(fs.readFileSync(path.join(start, "package.json"), "utf8"));
  const locked = lockPackages(start);
  const seen = new Set();
  const rows = [];
  function pushRow(body, dir, version) {
    const real = dir ? fs.realpathSync(dir) : `${body.name}@${version}`;
    if (seen.has(real) || body.name === "edulauncher" || body.name === "edulauncher-site") return "";
    seen.add(real);
    rows.push({
      name: body.name,
      version: body.version || version,
      license: typeof body.license === "string" ? body.license : "",
      repository: typeof body.repository === "string" ? body.repository : body.repository?.url || "",
      dir,
      installed: Boolean(dir),
    });
    return dir;
  }
  function walk(deps, parentDir, allowed) {
    for (const [name, info] of Object.entries(deps || {})) {
      if (info.extraneous || info.dev) continue;
      if (allowed && !allowed.has(name)) continue;
      if (info.missing || !info.version) {
        const fromLock = locked.get(name);
        if (!fromLock || fromLock.dev || !fromLock.version) continue;
        const found = findNodeModule(parentDir, name);
        let dir = "";
        if (found) {
          const installed = JSON.parse(fs.readFileSync(path.join(found, "package.json"), "utf8"));
          if (installed.version === fromLock.version) dir = found;
        }
        pushRow({ name, version: fromLock.version, license: fromLock.license || "", repository: "" }, dir, fromLock.version);
        const childDeps = {};
        for (const dep of Object.keys(fromLock.dependencies || {})) childDeps[dep] = { missing: true };
        walk(childDeps, dir || parentDir, new Set(Object.keys(fromLock.dependencies || {})));
        continue;
      }
      const dir = findNodeModule(parentDir, name);
      if (!dir) continue;
      const real = fs.realpathSync(dir);
      const body = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (!seen.has(real) && body.name !== "edulauncher" && body.name !== "edulauncher-site") {
        seen.add(real);
        rows.push({
          name: body.name,
          version: body.version || info.version,
          license: typeof body.license === "string" ? body.license : "",
          repository: typeof body.repository === "string" ? body.repository : body.repository?.url || "",
          dir,
          installed: true,
        });
      }
      walk(info.dependencies, dir, new Set(Object.keys(body.dependencies || {})));
    }
  }
  walk(tree.dependencies, start, new Set(Object.keys(rootPkg.dependencies || {})));
  return rows;
}

function crateForNpm(name) {
  if (name === "@tauri-apps/api") return "tauri";
  if (name.startsWith("@tauri-apps/plugin-")) return `tauri-${name.slice("@tauri-apps/".length)}`;
  return name;
}

const MPL_CRATES = new Set(["cssparser", "selectors", "dtoa-short", "option-ext"]);

function sourceCopyright(dir) {
  const src = path.join(dir, "src");
  if (!fs.existsSync(src)) return [];
  const files = [];
  const collect = (folder) => {
    for (const name of fs.readdirSync(folder)) {
      const full = path.join(folder, name);
      if (fs.statSync(full).isDirectory()) collect(full);
      else if (name.endsWith(".rs")) files.push(full);
    }
  };
  collect(src);
  files.sort((a, b) => {
    const rank = (file) => (path.basename(file) === "lib.rs" ? 0 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  for (const file of files) {
    const hits = readText(file).split(/\r?\n/).slice(0, 20).map((line) => line.trim()).filter((line) => isCopyrightLine(line));
    if (!hits.length) continue;
    const rel = path.relative(dir, file).replace(/\\/g, "/");
    return hits.map((line) => `${line} (${rel})`);
  }
  return [];
}

function standardMit(packages) {
  for (const pkg of packages.values()) {
    if (pkg.name !== "tauri") continue;
    const file = path.join(path.dirname(pkg.manifest_path), "LICENSE_MIT");
    const text = readText(file);
    if (!/Permission is hereby granted, free of charge/i.test(text)) continue;
    return text.split(/\r?\n/).filter((line) => !/copyright/i.test(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return "";
}

function assertMplUntouched(meta) {
  const problems = [];
  const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
  const cargo = fs.readFileSync(cargoPath, "utf8");
  if (/^\s*\[patch(\.[^\]]+)?\]/m.test(cargo)) problems.push("src-tauri/Cargo.toml에 [patch]가 있습니다.");
  if (/^\s*\[replace\]/m.test(cargo)) problems.push("src-tauri/Cargo.toml에 [replace]가 있습니다.");
  for (const rel of [".cargo/config", ".cargo/config.toml", "src-tauri/.cargo/config", "src-tauri/.cargo/config.toml", "vendor", "src-tauri/vendor"]) {
    if (fs.existsSync(path.join(root, rel))) problems.push(`${rel} 가 있습니다.`);
  }
  for (const pkg of meta.packages) {
    if (!MPL_CRATES.has(pkg.name)) continue;
    const source = pkg.source || "";
    if (!source.startsWith("registry+")) problems.push(`${pkg.name} ${pkg.version} 출처가 crates.io 레지스트리가 아닙니다: ${source || "없음"}`);
    const dir = path.dirname(pkg.manifest_path).replace(/\\/g, "/").toLowerCase();
    if (!dir.includes("/.cargo/registry/")) problems.push(`${pkg.name} 매니페스트가 로컬 cargo registry 밖에 있습니다.`);
  }
  const skip = new Set(["node_modules", "target", ".git", "dist", "website"]);
  const scan = (folder, depth) => {
    if (depth > 5 || !fs.existsSync(folder)) return;
    for (const name of fs.readdirSync(folder)) {
      if (skip.has(name)) continue;
      if (MPL_CRATES.has(name)) problems.push(`저장소에 ${name} 폴더가 있습니다: ${folder}`);
      const full = path.join(folder, name);
      if (fs.statSync(full).isDirectory()) scan(full, depth + 1);
    }
  };
  scan(root, 0);
  return problems;
}

function applyExceptions(rows, packages) {
  const mit = standardMit(packages);
  for (const row of rows) {
    const sameName = APPROVED_EXCEPTIONS.filter((item) => item.name === row.name);
    const exact = sameName.find((item) => item.version === row.version);
    if (sameName.length && !exact) {
      row.bucket = "판단불가";
      row.reason = `승인 예외 버전은 ${sameName.map((item) => item.version).join(", ")}, 현재는 ${row.version}`;
      continue;
    }
    if (!exact) {
      if (row.slash && !row.licenseText) {
        row.bucket = "판단불가";
        row.reason = "A/B 표기이고 라이선스 파일이 없으며 승인 예외가 아닙니다.";
      }
      continue;
    }
    row.exceptionReason = exact.reason;
    if (exact.license === "MPL-2.0") {
      row.mplSource = `이 구성요소는 수정 없이 사용되었으며, 소스 코드는 다음에서 구할 수 있습니다: https://crates.io/crates/${row.name}/${row.version}`;
      if (!row.copyrights.length) {
        const fromSrc = sourceCopyright(row.dir);
        row.copyrights = fromSrc.length ? fromSrc : row.authors.map((author) => `작성자(Cargo.toml authors): ${author}`);
      }
    }
    if (exact.license === "MIT/Apache-2.0") {
      row.chosen = ["MIT"];
      row.bucket = "허용-고지";
      row.note = "라이선스 파일이 패키지에 포함되지 않아 소스 주석의 표기를 따름";
      row.copyrights = sourceCopyright(row.dir);
      row.licenseText = mit;
      if (!mit) row.reason = "MIT 표준 전문을 로컬 LICENSE_MIT에서 찾지 못함";
    }
  }
  const mplText = rows.find((row) => row.licenseText && (row.chosen || []).includes("MPL-2.0"))?.licenseText || "";
  for (const row of rows) {
    if (approvedFor(row)?.license !== "MPL-2.0" || row.licenseText || !mplText) continue;
    row.licenseText = mplText;
    row.note = "이 크레이트 폴더에는 LICENSE 파일이 없어 다른 로컬 MPL-2.0 LICENSE 전문을 함께 둡니다.";
  }
}

function authorLines(row) {
  return (row.authors || []).filter(Boolean).map((author) => `저작권자 표기(Cargo.toml authors): ${author}`);
}

function repoLine(row) {
  return `저작권자 표기 없음, 저장소: ${row.repository || "없음"}`;
}

function fillCopyrightGaps(rows, packages) {
  const mit = standardMit(packages);
  const pattern = [];
  const bucketB = [];
  const bucketC = [];
  const bucketD = [];
  for (const row of rows) {
    if (row.kind !== "runtime" && row.kind !== "npm") continue;
    if (!(row.chosen || []).some((item) => item === "MIT" || item.startsWith("MIT "))) continue;
    const widened = linesMatching(row.licenseText || "", isCopyrightLine);
    const previous = linesMatching(row.licenseText || "", legacyCopyrightLine);
    if (widened.length && !previous.length) {
      if (!row.copyrights.length) row.copyrights = widened;
      pattern.push(row);
      continue;
    }
    if (row.copyrights.length) continue;
    if (row.licenseText) {
      row.attribution = authorLines(row).length ? authorLines(row) : [repoLine(row)];
      bucketB.push(row);
      continue;
    }
    const fromSrc = row.dir ? sourceCopyright(row.dir) : [];
    if (fromSrc.length) row.copyrights = fromSrc;
    else if (authorLines(row).length) row.attribution = authorLines(row);
    else if (row.repository) row.attribution = [repoLine(row)];
    else {
      bucketD.push(row);
      continue;
    }
    row.missingLicense = true;
    row.note = [row.note, "라이선스 파일 없음"].filter(Boolean).join(" ");
    if (mit) row.licenseText = mit;
    bucketC.push(row);
  }
  console.log("COPYRIGHT_CLASS", JSON.stringify({
    pattern: pattern.length,
    b: bucketB.length,
    c: bucketC.length,
    d: bucketD.length,
  }));
  console.log("PATTERN");
  for (const row of pattern) console.log(`${row.name} ${row.version}`);
  console.log("BUCKET_B");
  for (const row of bucketB) console.log(`${row.name}\t${row.version}\t${row.attribution.join(" | ")}`);
  console.log("BUCKET_C");
  for (const row of bucketC) console.log(`${row.name}\t${row.version}\t${(row.copyrights[0] || row.attribution.join(" | "))}`);
  console.log("BUCKET_D");
  for (const row of bucketD) console.log(`${row.name}\t${row.version}\t${row.via || ""}`);
  return bucketD;
}

function webview2Fixed(packages) {
  for (const pkg of packages.values()) {
    if (pkg.name !== "webview2-com-sys" || pkg.version !== "0.38.2") continue;
    const dir = path.dirname(pkg.manifest_path);
    const staticLib = path.join(dir, "x64", "WebView2LoaderStatic.lib");
    const loaderDll = path.join(dir, "x64", "WebView2Loader.dll");
    const licenseFiles = [...listFiles(dir), ...listFiles(path.join(dir, "x64"))];
    const linked = fs.existsSync(staticLib);
    const lines = [
      "Microsoft WebView2 SDK (WebView2Loader)",
      linked
        ? "x64/WebView2LoaderStatic.lib가 크레이트에 있다. MSVC용 src/lib.rs는 이 정적 라이브러리를 링크한다."
        : "x64/WebView2LoaderStatic.lib를 크레이트 폴더에서 찾지 못했다.",
      fs.existsSync(loaderDll) ? "x64/WebView2Loader.dll도 같은 폴더에 있다. MSVC 링크 설정이 가리키는 것은 정적 라이브러리이다." : "",
      licenseFiles.length ? "아래는 크레이트 폴더의 라이선스 원문이다." : "크레이트 폴더에서 라이선스 원문 파일은 찾지 못했다.",
    ].filter(Boolean);
    return { text: lines.join("\n"), licenseText: licenseFiles.map(readText).join("\n").trim() };
  }
  return { text: "Microsoft WebView2 SDK (WebView2Loader)\nwebview2-com-sys 0.38.2를 로컬 cargo registry에서 찾지 못했다.", licenseText: "" };
}

function sqliteBlessing(packages) {
  for (const pkg of packages.values()) {
    if (pkg.name !== "libsqlite3-sys") continue;
    const header = path.join(path.dirname(pkg.manifest_path), "sqlite3", "sqlite3.h");
    const text = readText(header);
    const lines = text.split(/\r?\n/).slice(0, 12).join("\n");
    if (lines.includes("blessing") || lines.includes("disclaims copyright")) return lines;
  }
  return "확인 불가";
}

function render(entries, fixed) {
  const bodies = new Map();
  const chunks = [];
  chunks.push("교육업무 런처");
  chunks.push("이 프로그램에 포함된 오픈소스 구성요소입니다.");
  chunks.push("라이선스 준수를 보장하지 않습니다.");
  chunks.push("");
  for (const entry of entries) {
    chunks.push("------------------------------------------------------------");
    chunks.push(`${entry.origin} ${entry.name} ${entry.version}`);
    chunks.push(`라이선스: ${entry.license || "없음"}`);
    if (entry.chosen.length) chunks.push(`선택: ${entry.chosen.join(" AND ")}`);
    if (entry.sourceNote) chunks.push(`라이선스 파일 출처: ${entry.sourceNote}`);
    if (entry.note) chunks.push(entry.note);
    if (entry.exceptionReason) chunks.push(`예외 사유: ${entry.exceptionReason}`);
    if (entry.mplSource) chunks.push(entry.mplSource);
    if (entry.repository) chunks.push(`저장소: ${entry.repository}`);
    if (entry.copyrights.length) {
      chunks.push("저작권:");
      for (const line of entry.copyrights) chunks.push(line);
    }
    if (entry.attribution?.length) {
      for (const line of entry.attribution) chunks.push(line);
    }
    if (!entry.copyrights.length && !entry.attribution?.length) {
      chunks.push("저작권: 저작권 줄을 찾지 못함");
    }
    if (entry.missingLicense) chunks.push("라이선스 파일 없음");
    if (!entry.licenseText && !entry.missingLicense) {
      chunks.push("라이선스 파일 없음");
    } else if (entry.licenseText) {
      const key = entry.licenseText.trim();
      if (!bodies.has(key)) bodies.set(key, { title: entry.chosen.join(" AND ") || "라이선스", text: key });
      chunks.push(`라이선스 전문은 아래 "${entry.chosen.join(" AND ") || "라이선스"}" 묶음과 같습니다.`);
    }
    if (entry.noticeText) {
      chunks.push("NOTICE:");
      chunks.push(entry.noticeText.trim());
    }
    chunks.push("");
  }
  if (fixed) {
    chunks.push("------------------------------------------------------------");
    chunks.push("고정 항목");
    chunks.push(fixed.trim());
    chunks.push("");
  }
  chunks.push("============================================================");
  chunks.push("라이선스 전문");
  chunks.push("");
  for (const body of bodies.values()) {
    chunks.push(`##### ${body.title}`);
    chunks.push(body.text);
    chunks.push("");
  }
  return `${chunks.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function writeIfChanged(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) {
    console.log(`unchanged ${file}`);
    return;
  }
  fs.writeFileSync(file, text, "utf8");
  console.log(`wrote ${file} ${Buffer.byteLength(text)} bytes`);
}

function approvedFor(row) {
  return APPROVED_EXCEPTIONS.find((item) => item.name === row.name && item.version === row.version);
}

function blocked(rows) {
  return rows.filter((row) => ["조건부", "금지", "판단불가"].includes(row.bucket) && !approvedFor(row));
}

function printReport(title, rows) {
  const counts = {};
  const hist = {};
  for (const row of rows) {
    counts[row.kind] = (counts[row.kind] || 0) + 1;
    const key = `${row.kind}|${row.bucket}|${row.chosen.join(" AND ") || "없음"}`;
    hist[key] = (hist[key] || 0) + 1;
  }
  console.log(`# ${title}`);
  console.log("COUNTS", JSON.stringify(counts));
  for (const key of Object.keys(hist).sort()) console.log(`${hist[key]}\t${key}`);
  const bad = blocked(rows.filter((row) => row.kind === "runtime" || row.kind === "npm"));
  console.log("PROBLEMS", bad.length);
  for (const row of bad) {
    console.log([row.kind, row.name, row.version, row.license || "없음", row.bucket, row.via || "", row.reason].join("\t"));
  }
  return bad;
}

function rustRows(meta) {
  const { packages, role, via } = graphOf(meta);
  const rows = [];
  for (const [id, kind] of role) {
    const pkg = packages.get(id);
    if (!pkg || pkg.name === "edulauncher") continue;
    const dir = path.dirname(pkg.manifest_path);
    const files = listFiles(dir);
    let cls = refine(pkg, classify(pkg.license), files);
    const picked = chosenFile(files, cls.chosen);
    const notice = files.filter((file) => /^notice/i.test(path.basename(file))).map(readText).join("\n").trim();
    rows.push({
      kind,
      origin: "rust",
      name: pkg.name,
      version: pkg.version,
      license: pkg.license || "",
      bucket: cls.bucket,
      chosen: cls.chosen,
      reason: cls.reason,
      slash: Boolean(cls.slash),
      via: [...(via.get(id) || [])].sort().join(","),
      repository: pkg.repository || "",
      authors: pkg.authors || [],
      copyrights: picked ? copyrightLines(picked.text) : [],
      licenseText: picked ? picked.text : "",
      sourceNote: "",
      note: "",
      exceptionReason: "",
      mplSource: "",
      noticeText: notice,
      attribution: [],
      missingLicense: false,
      dir,
    });
  }
  rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { rows, packages };
}

function npmRows(start, rustPackages) {
  const byName = new Map();
  if (rustPackages) {
    for (const pkg of rustPackages.values()) {
      if (!byName.has(pkg.name)) byName.set(pkg.name, pkg);
    }
  }
  const borrowed = [];
  const rows = npmPackages(start).map((item) => {
    const cls = classify(typeof item.license === "string" ? item.license : "");
    let files = item.dir ? listFiles(item.dir) : [];
    let sourceNote = "";
    if (!files.length && rustPackages) {
      const crateName = crateForNpm(item.name);
      const crate = byName.get(crateName);
      if (crate) {
        files = listFiles(path.dirname(crate.manifest_path));
        if (files.length) {
          sourceNote = `cargo registry ${crate.name} ${crate.version}`;
          borrowed.push(`${item.name} -> ${crate.name} ${crate.version}`);
        }
      }
    }
    const picked = chosenFile(files, cls.chosen);
    const notice = files.filter((file) => /^notice/i.test(path.basename(file))).map(readText).join("\n").trim();
    return {
      kind: "npm",
      origin: "npm",
      name: item.name,
      version: item.version,
      license: typeof item.license === "string" ? item.license : "",
      bucket: cls.bucket,
      chosen: cls.chosen,
      reason: cls.reason,
      slash: Boolean(cls.slash),
      via: "package.json dependencies",
      repository: item.repository,
      authors: [],
      copyrights: picked ? copyrightLines(picked.text) : [],
      licenseText: picked ? picked.text : "",
      sourceNote,
      note: item.installed === false ? "설치된 패키지 폴더가 없어 package-lock.json의 license 필드만 사용함" : "",
      exceptionReason: "",
      mplSource: "",
      noticeText: notice,
      attribution: [],
      missingLicense: false,
      dir: item.dir || "",
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, borrowed };
}

const fixedText = `SQLite
libsqlite3-sys의 bundled 기능으로 sqlite3.c가 실행 파일에 컴파일된다. SQLCipher 기능은 꺼져 있다.
래퍼 크레이트의 license 필드는 MIT이다. 아래는 sqlite3.h 앞부분의 저작권 포기와 축복 문구이다.

NSIS
tauri.conf.json의 nsis에는 compression 키가 없다.
로컬 tauri-utils 2.9.3의 NsisCompression 기본값은 Lzma이다. 설치 프로그램 압축은 LZMA이다.
Tauri NSIS 설치 스크립트 템플릿(src-tauri/windows/installer.nsi)은 Apache-2.0 OR MIT이며, 선택은 MIT이다. 그 고지는 Tauri 패키지 항목에 포함된다.
NSIS 라이선스 원문 파일: 확인 불가
LZMA 구성요소 라이선스 원문 파일: 확인 불가`;

function main() {
  if (siteOnly) {
    const site = npmRows(path.join(root, "website"), null);
    const bad = printReport("site", site.rows);
    if (bad.length && !reportOnly) {
      console.error("조건부·금지·판단 불가가 있어 사이트 고지 파일을 만들지 않습니다.");
      process.exit(2);
    }
    if (!reportOnly) {
      writeIfChanged(path.join(root, "website", "public", "third-party-notices.txt"), render(site.rows, ""));
    }
    process.exit(bad.length ? 2 : 0);
  }

  const meta = loadMetadata();
  const mplProblems = assertMplUntouched(meta);
  console.log("MPL_CHECK", mplProblems.length ? mplProblems.join(" | ") : "patch/replace/vendor/복사 흔적 없음");
  if (mplProblems.length) process.exit(2);
  const rust = rustRows(meta);
  applyExceptions(rust.rows, rust.packages);
  const missingMit = rust.rows.filter((row) => approvedFor(row)?.license === "MIT/Apache-2.0" && !row.licenseText);
  if (missingMit.length) {
    console.error("승인된 unic 계열의 MIT 전문을 로컬 파일에서 만들지 못했습니다.");
    process.exit(2);
  }
  const npm = npmRows(root, rust.packages);
  const runtime = rust.rows.filter((row) => row.kind === "runtime");
  const bad = printReport("app", [...rust.rows, ...npm.rows]);
  if (unknownTargets.size) {
    console.log("UNKNOWN_CFG");
    for (const target of unknownTargets) console.log(target);
  }
  console.log("BORROWED");
  for (const line of npm.borrowed) console.log(line);
  console.log("SQLITE_HEADER_START");
  console.log(sqliteBlessing(rust.packages).split("\n")[3] || "");
  const runtimeBad = blocked(runtime);
  if (runtimeBad.length) {
    console.error("실행 파일 포함 목록에 조건부·금지·판단 불가가 있습니다. 고지 파일과 앱은 수정하지 않습니다.");
    process.exit(2);
  }
  const gaps = fillCopyrightGaps([...runtime, ...npm.rows], rust.packages);
  if (gaps.length) {
    console.error("라이선스 문구와 저작권 주석, authors, 저장소가 모두 없는 패키지가 있습니다.");
    process.exit(2);
  }
  if (reportOnly) process.exit(0);
  const blessing = sqliteBlessing(rust.packages);
  const loader = webview2Fixed(rust.packages);
  const fixed = `${fixedText}\n\n${blessing}\n\n${loader.text}${loader.licenseText ? `\n\n${loader.licenseText}` : ""}`;
  const included = [...runtime, ...npm.rows];
  writeIfChanged(path.join(root, "src-tauri", "resources", "THIRD_PARTY_NOTICES.txt"), render(included, fixed));
  const chosen = {};
  for (const row of included) {
    const key = row.chosen.join(" AND ") || "없음";
    chosen[key] = (chosen[key] || 0) + 1;
  }
  console.log("CHOSEN", JSON.stringify(chosen));
  console.log("NOTICE_FILES");
  for (const row of included) if (row.noticeText) console.log(`${row.origin} ${row.name} ${row.version}`);
  console.log("UNIC");
  for (const row of included) {
    if (!row.name.startsWith("unic-")) continue;
    console.log(`${row.name} ${row.version}`);
    for (const line of row.copyrights) console.log(line);
  }
  console.log("INCLUDED", JSON.stringify({
    rust: runtime.length,
    npm: npm.rows.length,
    fixed: 2,
  }));
}

main();

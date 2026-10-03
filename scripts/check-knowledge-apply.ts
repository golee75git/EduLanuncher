import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { replaceHandbookPack } from "../src/services/handbookFlowData";
import { replaceSection2 } from "../src/services/knowledgeService";
import { applyVerifiedIndex, manualIndexUnavailable } from "../src/services/manualIndexService";
import { replaceManualRoot } from "../src/services/manualService";
import { parseTopics, replaceTopicFile } from "../src/services/topicService";

const dir = resolve("website/dist/knowledge");
if (!existsSync(resolve(dir, "pack/topics.json"))) {
  console.log("skip");
  process.exit(0);
}

function load(name: string): unknown {
  return JSON.parse(readFileSync(resolve(dir, name), "utf8")) as unknown;
}

function topicCount(raw: unknown): number {
  if (!raw || typeof raw !== "object" || !("topics" in raw) || !Array.isArray(raw.topics)) {
    return 0;
  }
  return raw.topics.length;
}

const topics = load("pack/topics.json");
const handbook = load("pack/handbook.json");
const master = load("pack/master.json");
const epki = load("pack/epki.json");
const index = load("search-index.json") as { topics?: unknown };

const topicOk = replaceTopicFile(topics);
const handbookOk = replaceHandbookPack(handbook);
const masterOk = replaceSection2(master);
const epkiOk = replaceManualRoot(epki);
applyVerifiedIndex(index);

const indexTopics = index && Array.isArray(index.topics) ? index.topics : [];
const indexCount = indexTopics.filter(
  (topic) =>
    !!topic &&
    typeof topic === "object" &&
    typeof (topic as { id?: unknown }).id === "string" &&
    typeof (topic as { title?: unknown }).title === "string",
).length;
const indexOk = manualIndexUnavailable() === "" && indexCount >= 10;

const report = {
  replaceTopicFile: { ok: topicOk, count: topicOk ? parseTopics(topics).length : 0 },
  replaceHandbookPack: { ok: handbookOk, count: handbookOk ? topicCount(handbook) : 0 },
  replaceSection2: { ok: masterOk, count: masterOk ? topicCount(master) : 0 },
  replaceManualRoot: { ok: epkiOk, count: epkiOk ? 1 : 0 },
  applyVerifiedIndex: { ok: indexOk, count: indexOk ? indexCount : 0 },
};

console.log(JSON.stringify(report));
if (!topicOk || !handbookOk || !masterOk || !epkiOk || !indexOk) {
  process.exit(2);
}

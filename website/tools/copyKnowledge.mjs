import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(websiteRoot, "..");
const outDir = path.join(websiteRoot, "public", "knowledge");

const pack = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/data/handbookFlowPack.json"), "utf8"));
const topics = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/data/topics.json"), "utf8"));
const master = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/data/knowledge/master.json"), "utf8"));
const epki = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/data/manuals/epki.json"), "utf8"));

const handbook = {
  categories: (pack.categories ?? []).map((category) => ({
    id: category.id,
    name: category.name,
    pages: category.pages ?? "",
    topicIds: category.topic_ids ?? [],
  })),
  topics: (pack.topics ?? []).map((topic) => ({
    id: topic.topic_id,
    categoryId: topic.category_id,
    title: topic.title,
    officialName: topic.official_code_name,
    pages: topic.pages ?? "",
  })),
};

const topicIndex = topics.map((topic) => ({
  id: topic.id,
  title: topic.title,
  category: topic.category ?? "",
  subcategory: topic.subcategory ?? "",
  description: topic.description ?? "",
  beginnerSummary: topic.beginnerSummary ?? "",
}));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "handbook.json"), JSON.stringify(handbook));
fs.writeFileSync(path.join(outDir, "topics.json"), JSON.stringify(topicIndex));
fs.writeFileSync(path.join(outDir, "master.json"), JSON.stringify(master));
fs.writeFileSync(path.join(outDir, "epki.json"), JSON.stringify(epki));
fs.writeFileSync(
  path.join(outDir, "catalog.json"),
  JSON.stringify({
    generatedAt: "2026-09-27",
    handbookTopics: handbook.topics.length,
    topics: topicIndex.length,
    section2Topics: master.topics?.length ?? 0,
  }),
);
console.log("knowledge files", handbook.topics.length, topicIndex.length);

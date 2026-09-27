import fs from "fs";

const sourcePath = "knowledge-source/LauncherBox_Master_Extraction-0927.md";
const md = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");

function plain(text) {
  return text
    .replace(/\r/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^#\s*$/gm, "")
    .replace(/^#### .*\n/gm, "")
    .replace(/^---\s*$/gm, "")
    .replace(/^\| :---.*$/gm, "")
    .replace(/^\|(.+)\|$/gm, (_, row) =>
      row
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(" · "),
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitRef(text) {
  const lines = text.split("\n");
  let index = lines.length;
  const ref = [];
  while (index > 0 && lines[index - 1].trim() === "") index -= 1;
  while (index > 0 && lines[index - 1].trim().startsWith("- ")) {
    ref.unshift(lines[index - 1].trim().replace(/^- /, ""));
    index -= 1;
  }
  while (index > 0 && lines[index - 1].trim() === "") index -= 1;
  const looks = /규정|법|조례|규칙|편람|지침|매뉴얼|안내/.test(ref.join(" "));
  if (!looks || ref.length < 2) return { body: text.trim(), reference: "" };
  return { body: lines.slice(0, index).join("\n").trim(), reference: ref.join("\n") };
}

const categoryMarks = [...md.matchAll(/^# (\d{2}\. .+)$/gm)];
const topicMarks = [...md.matchAll(/^## Topic: \[(.+?)\]/gm)];
const topics = [];
let templateSections = 0;

for (let index = 0; index < topicMarks.length; index += 1) {
  const from = topicMarks[index].index;
  const to = index + 1 < topicMarks.length ? topicMarks[index + 1].index : md.length;
  let block = md.slice(from, to);
  const category = [...categoryMarks].reverse().find((mark) => mark.index < from);
  const cut = block.search(/^### 3\. /m);
  if (cut >= 0) {
    templateSections += 1;
    block = block.slice(0, cut);
  }
  const parts = [...block.matchAll(/^### \[세부업무 \d+\] (.+)$/gm)];
  const tasks = [];
  for (let part = 0; part < parts.length; part += 1) {
    const start = parts[part].index;
    const end = part + 1 < parts.length ? parts[part + 1].index : block.length;
    const section = block.slice(start, end);
    const tipAt = section.search(/^#### TIP/m);
    let main = section;
    let tip = "";
    if (tipAt >= 0) {
      main = section.slice(0, tipAt);
      tip = section.slice(tipAt).replace(/^#### TIP[^\n]*\n/, "");
    }
    const mainBody = main.replace(/^### \[세부업무[^\n]*\n/, "").replace(/^#### 주요내용\n/, "");
    const mainSplit = splitRef(plain(mainBody).replace(/^- 주요내용:\s*\n/, ""));
    const tipSplit = splitRef(plain(tip).replace(/^- TIP[^\n]*:\s*\n/, ""));
    tasks.push({
      name: parts[part][1].trim().replace(/&amp;/g, "&"),
      body: mainSplit.body,
      tip: tipSplit.body,
      reference: [mainSplit.reference, tipSplit.reference].filter(Boolean).join("\n"),
    });
  }
  topics.push({
    markdownTitle: topicMarks[index][1].trim().replace(/&amp;/g, "&"),
    category: category ? category[1].trim() : "",
    tasks,
  });
}

const existing = JSON.parse(fs.readFileSync("src/data/topics.json", "utf8"));
const byTitle = new Map();
for (const topic of existing) {
  const title = String(topic.title ?? "").trim();
  if (!title) continue;
  const list = byTitle.get(title) ?? [];
  list.push(topic.id);
  byTitle.set(title, list);
}

const pack = JSON.parse(fs.readFileSync("src/data/handbookFlowPack.json", "utf8"));
const handbookNames = new Set(
  (pack.topics ?? []).map((topic) => String(topic.official_code_name ?? "").trim()).filter(Boolean),
);

let taskCount = 0;
const matchedTopicIds = [];
const unmatchedHandbook = [];
const duplicateTaskNames = [];
const taskNameOwners = new Map();

for (const topic of topics) {
  topic.matchedTopicIds = byTitle.get(topic.markdownTitle) ?? [];
  for (const id of topic.matchedTopicIds) matchedTopicIds.push(id);
  taskCount += topic.tasks.length;
  for (const task of topic.tasks) {
    const owners = taskNameOwners.get(task.name) ?? [];
    owners.push(topic.markdownTitle);
    taskNameOwners.set(task.name, owners);
    task.matchedTopicIds = byTitle.get(task.name) ?? [];
    for (const id of task.matchedTopicIds) matchedTopicIds.push(id);
  }
  if (!handbookNames.has(topic.markdownTitle)) unmatchedHandbook.push(topic.markdownTitle);
}

for (const [name, owners] of taskNameOwners) {
  if (owners.length > 1) duplicateTaskNames.push({ name, topics: owners });
}

const emptyTopics = topics.filter((topic) => topic.tasks.length === 0).map((topic) => topic.markdownTitle);
const master = {
  metadata: {
    schemaVersion: "1.0",
    source: sourcePath,
    generatedAt: "2026-09-27",
    categoryCount: new Set(topics.map((topic) => topic.category).filter(Boolean)).size,
    topicCount: topics.length,
    taskCount,
  },
  topics,
};

const validation = {
  valid: true,
  categories: master.metadata.categoryCount,
  topics: topics.length,
  section2Tasks: taskCount,
  templateSectionsSkipped: templateSections,
  matchedExistingTopicIds: [...new Set(matchedTopicIds)],
  handbookUnmatched: unmatchedHandbook,
  duplicateTaskNames,
  emptyTopics,
  warnings: [
    "3장 업무절차부터 8장 자연어 검색은 업무마다 같은 공통 틀이라 master에 넣지 않았다.",
    ...(emptyTopics.length ? [`세부업무 제목이 없는 Topic ${emptyTopics.length}개는 본문을 만들지 않았다.`] : []),
    ...(unmatchedHandbook.length ? [`편람 분류 이름과 제목이 다른 Topic ${unmatchedHandbook.length}개는 편람 칸에 붙이지 않았다.`] : []),
  ],
  errors: [],
};

fs.mkdirSync("src/data/knowledge", { recursive: true });
fs.writeFileSync("src/data/knowledge/master.json", `${JSON.stringify(master, null, 2)}\n`);
fs.writeFileSync("src/data/knowledge/knowledge-validation.json", `${JSON.stringify(validation, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      topics: topics.length,
      tasks: taskCount,
      templateSections,
      matchedIds: validation.matchedExistingTopicIds.length,
      handbookUnmatched: unmatchedHandbook.length,
      duplicateTaskNames: duplicateTaskNames.length,
      emptyTopics: emptyTopics.length,
      valid: validation.valid,
    },
    null,
    2,
  ),
);

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

function splitChartLines(text) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      const trimmed = current.trim();
      if (trimmed) out.push(trimmed);
      current = "";
      continue;
    }
    current += char === "\n" || char === "\r" ? " " : char;
  }
  const trimmed = current.trim();
  if (trimmed) out.push(trimmed);
  return out;
}

function readNode(line, start) {
  let index = start;
  while (line[index] === " ") index += 1;
  const idMatch = /^[A-Za-z][A-Za-z0-9_]*/.exec(line.slice(index));
  if (!idMatch) return null;
  const id = idMatch[0];
  index += id.length;
  while (line[index] === " ") index += 1;
  let label = id;
  if (line.startsWith('(["', index)) {
    const end = line.indexOf('"])', index + 3);
    if (end < 0) return { id, label, end: line.length };
    label = line.slice(index + 3, end);
    index = end + 3;
  } else if (line.startsWith('["', index)) {
    const end = line.indexOf('"]', index + 2);
    if (end < 0) return { id, label, end: line.length };
    label = line.slice(index + 2, end);
    index = end + 2;
  } else if (line.startsWith('{"', index)) {
    const end = line.indexOf('"}', index + 2);
    if (end < 0) return { id, label, end: line.length };
    label = line.slice(index + 2, end);
    index = end + 2;
  }
  return { id, label: label.replace(/\s+/g, " ").trim() || id, end: index };
}

function readArrow(line, start) {
  let index = start;
  while (line[index] === " ") index += 1;
  if (line.startsWith("-->", index)) {
    index += 3;
    while (line[index] === " ") index += 1;
    if (line[index] === "|") {
      const end = line.indexOf("|", index + 1);
      if (end < 0) return { end: line.length };
      return { end: end + 1 };
    }
    return { end: index };
  }
  if (line.startsWith("--", index)) {
    const arrow = line.indexOf("-->", index + 2);
    if (arrow < 0) return null;
    return { end: arrow + 3 };
  }
  return null;
}

function shortLabel(label) {
  const rest = label.replace(/^TOPIC-[A-Za-z0-9-]+\s+/, "").trim();
  return rest || label;
}

function readChart(chart) {
  const nodes = new Map();
  const order = [];
  const arrows = [];
  const remember = (id, label) => {
    if (!nodes.has(id)) {
      nodes.set(id, label);
      order.push(id);
      return;
    }
    if (label !== id) nodes.set(id, label);
  };
  for (const line of splitChartLines(String(chart ?? ""))) {
    if (line.startsWith("flowchart")) continue;
    let left = readNode(line, 0);
    if (!left) continue;
    remember(left.id, left.label);
    while (left) {
      const arrow = readArrow(line, left.end);
      if (!arrow) break;
      const right = readNode(line, arrow.end);
      if (!right) break;
      remember(right.id, right.label);
      arrows.push({ from: left.id, to: right.id });
      left = right;
    }
  }
  if (order.length === 0) return null;
  const incoming = new Map(order.map((id) => [id, 0]));
  for (const arrow of arrows) incoming.set(arrow.to, (incoming.get(arrow.to) ?? 0) + 1);
  const rootId = order.find((id) => (incoming.get(id) ?? 0) === 0) ?? order[0];
  const placed = new Set();
  const build = (id) => {
    placed.add(id);
    const children = [];
    for (const arrow of arrows) {
      if (arrow.from !== id || placed.has(arrow.to)) continue;
      children.push(build(arrow.to));
    }
    return { id, label: shortLabel(nodes.get(id) ?? id), children };
  };
  const tree = build(rootId);
  for (const id of order) {
    if (!placed.has(id)) tree.children.push(build(id));
  }
  return tree;
}

function markTargets(node, targets) {
  if (!node) return null;
  const target = targets.get(node.id);
  return {
    id: node.id,
    label: node.label,
    ...(target ? target : {}),
    children: node.children.map((child) => markTargets(child, targets)).filter(Boolean),
  };
}

const stepTextUse = new Map();
for (const topic of pack.topics ?? []) {
  const seen = new Set();
  for (const step of topic.step_attributes ?? []) {
    const text = String(step.description ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    stepTextUse.set(text, (stepTextUse.get(text) ?? 0) + 1);
  }
}

function isSharedTemplate(topic) {
  if (String(topic.decision_tree ?? "").trim()) return false;
  const seen = new Set();
  const descriptions = [];
  for (const step of topic.step_attributes ?? []) {
    const text = String(step.description ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    descriptions.push(text);
  }
  return descriptions.length > 0 && descriptions.every((text) => (stepTextUse.get(text) ?? 0) >= 10);
}

function flowTitles(title) {
  const matches = topics.filter(
    (row) => String(row.subcategory ?? "").trim() === String(title ?? "").trim() && Array.isArray(row.workflow) && row.workflow.length >= 2,
  );
  const sequences = new Set(
    matches.map((row) => row.workflow.map((step) => String(step.title ?? "").trim()).filter(Boolean).join("\n")),
  );
  if (sequences.size !== 1) return null;
  const names = matches[0].workflow.map((step) => String(step.title ?? "").trim()).filter(Boolean);
  return names.length >= 2 ? names : null;
}

function chainPicture(topicId, names) {
  let tree = null;
  for (let index = names.length - 1; index >= 0; index -= 1) {
    tree = {
      id: `${topicId}-flow-${index + 1}`,
      label: names[index],
      pick: names[index],
      children: tree ? [tree] : [],
    };
  }
  return tree;
}

function topicPicture(topic) {
  if (isSharedTemplate(topic)) {
    const names = flowTitles(topic.title);
    return names ? chainPicture(topic.topic_id, names) : null;
  }
  const targets = new Map();
  for (const link of topic.nodeMapping ?? []) {
    if (link?.nodeId && link.targetTopicId) targets.set(link.nodeId, { pick: "" });
  }
  const tree = readChart(topic.topic_mermaid);
  if (!tree) return null;
  const mark = (node) => ({
    id: node.id,
    label: node.label,
    ...(targets.has(node.id) ? { pick: node.label } : {}),
    children: node.children.map(mark),
  });
  return mark(tree);
}

const handbook = {
  categories: (pack.categories ?? []).map((category) => {
    const targets = new Map();
    for (const link of category.categoryNodeMapping ?? []) {
      if (link?.nodeId && link.targetTopicId) targets.set(link.nodeId, { topicId: link.targetTopicId });
    }
    return {
      id: category.id,
      name: category.name,
      pages: category.pages ?? "",
      topicIds: category.topic_ids ?? [],
      picture: markTargets(readChart(category.category_mermaid), targets),
    };
  }),
  topics: (pack.topics ?? []).map((topic) => ({
    id: topic.topic_id,
    categoryId: topic.category_id,
    title: topic.title,
    officialName: topic.official_code_name,
    pages: topic.pages ?? "",
    picture: topicPicture(topic),
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

const packDir = path.join(outDir, "pack");
fs.mkdirSync(packDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "handbook.json"), JSON.stringify(handbook));
fs.writeFileSync(path.join(outDir, "topics.json"), JSON.stringify(topicIndex));
fs.writeFileSync(path.join(outDir, "master.json"), JSON.stringify(master));
fs.writeFileSync(path.join(outDir, "epki.json"), JSON.stringify(epki));
fs.writeFileSync(path.join(packDir, "handbook.json"), JSON.stringify(pack));
fs.writeFileSync(path.join(packDir, "topics.json"), JSON.stringify(topics));
fs.writeFileSync(path.join(packDir, "master.json"), JSON.stringify(master));
fs.writeFileSync(path.join(packDir, "epki.json"), JSON.stringify(epki));
fs.writeFileSync(
  path.join(outDir, "catalog.json"),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    handbookTopics: handbook.topics.length,
    topics: topicIndex.length,
    section2Topics: master.topics?.length ?? 0,
  }),
);
console.log("knowledge files", handbook.topics.length, topicIndex.length);

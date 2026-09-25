import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { readHandbookPack } from "../src/services/handbookFlow.ts";

const sourcePath = "HelpMake/launcherbox-gpt-cursor-master-data-v6.json";
const copyPath = "src/data/handbookFlowPack.json";
const sourceBytes = readFileSync(sourcePath);
const copyBytes = readFileSync(copyPath);
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
const copyHash = createHash("sha256").update(copyBytes).digest("hex");
const raw = JSON.parse(copyBytes.toString("utf8")) as {
  categories?: Array<{ id?: string; topic_count?: number; topic_ids?: string[] }>;
  topics?: Array<{ topic_id?: string; title?: string }>;
};
const catalog = readHandbookPack(raw);
const topicIds = (raw.topics ?? []).map((topic) => topic.topic_id).filter((id): id is string => Boolean(id));
const categoryIds = (raw.categories ?? []).map((category) => category.id).filter((id): id is string => Boolean(id));
const dupTopics = topicIds.filter((id, index) => topicIds.indexOf(id) !== index);
const dupCategories = categoryIds.filter((id, index) => categoryIds.indexOf(id) !== index);
const lines: string[] = [];
lines.push("# 편람 흐름 자료 검사");
lines.push("");
lines.push(`분류 ${catalog.categories.length}개, 업무 ${catalog.topics.length}개.`);
lines.push(`원본 SHA256 ${sourceHash}`);
lines.push(`복사본 SHA256 ${copyHash}`);
lines.push(sourceHash === copyHash ? "체크섬이 같습니다." : "체크섬이 다릅니다.");
lines.push(`중복 분류 번호 ${dupCategories.length}개, 중복 업무 번호 ${dupTopics.length}개.`);
lines.push("");
lines.push("## 분류별 개수");
for (const category of catalog.categories) {
  const actualIds = new Set(category.topics.map((topic) => topic.id));
  const missingDeclared = category.declaredIds.filter((id) => !actualIds.has(id));
  const extra = category.topics.filter((topic) => !category.declaredIds.includes(topic.id)).map((topic) => topic.id);
  lines.push(
    `- ${category.id} ${category.name}: 적힌 수 ${category.declaredCount}, 들어 있는 수 ${category.topics.length}, 그림 상자 ${category.picture.nodeIds.length}, 되돌아가는 연결 ${category.picture.backArrows.length}`,
  );
  if (missingDeclared.length > 0) {
    lines.push(`  - 목록에만 있음: ${missingDeclared.join(", ")}`);
  }
  if (extra.length > 0) {
    lines.push(`  - 들어 있으나 목록에 없음: ${extra.join(", ")}`);
  }
  const broken = category.links.filter((link) => !link.nodeInChart || !link.topicExists || !link.stepExists);
  for (const link of broken) {
    lines.push(
      `  - 연결 ${link.nodeId}: 그림 ${link.nodeInChart ? "있음" : "없음"}, 업무 ${link.topicExists ? "있음" : "없음"}, 단계 ${link.stepExists ? "있음" : "없음"} (${link.targetTopicId} ${link.targetStepId})`,
    );
  }
}
const knownCategories = new Set(catalog.categories.map((category) => category.id));
const loose = catalog.topics.filter((topic) => !knownCategories.has(topic.categoryId));
lines.push("");
lines.push(`분류에 없는 업무 ${loose.length}개.`);
for (const topic of loose) {
  lines.push(`- ${topic.id} ${topic.categoryId}`);
}
lines.push("");
lines.push("## 업무 그림");
let chartFail = 0;
let linkBroken = 0;
let general = 0;
for (const topic of catalog.topics) {
  if (!topic.picture.tree) {
    chartFail += 1;
    lines.push(`- 그림을 풀지 못함 ${topic.id} ${topic.title}`);
  }
  if (topic.generalGuidance) {
    general += 1;
  }
  for (const link of topic.links) {
    if (!link.nodeInChart || !link.topicExists || !link.stepExists) {
      linkBroken += 1;
      lines.push(
        `- ${topic.id} 연결 ${link.nodeId}: 그림 ${link.nodeInChart ? "있음" : "없음"}, 업무 ${link.topicExists ? "있음" : "없음"}, 단계 ${link.stepExists ? "있음" : "없음"} (${link.targetTopicId} ${link.targetStepId})`,
      );
    }
  }
}
lines.push(`일반 안내로 표시하는 업무 ${general}개.`);
lines.push(`단계 연결 이상 ${linkBroken}개. 그림 실패 ${chartFail}개.`);
lines.push(`같은 단계 문장이 10개 이상 업무에 반복 ${catalog.repeatedStepTexts.length}개.`);
lines.push("");
lines.push("## 기존 업무 번호");
const existingTopics = JSON.parse(readFileSync("src/data/topics.json", "utf8")) as Array<{
  id?: string;
  title?: string;
  detail?: { externalTopicId?: string };
}>;
const existingIds = new Set(existingTopics.map((topic) => topic.id).filter((id): id is string => Boolean(id)));
const shared = catalog.topics.filter((topic) => existingIds.has(topic.id));
lines.push(`기존 업무 id와 같은 편람 흐름 번호 ${shared.length}개. 병합하지 않음.`);
const externalHits = existingTopics.flatMap((topic) => {
  const external = topic.detail?.externalTopicId;
  if (!external) {
    return [];
  }
  const match = catalog.topics.find((item) => item.id === external);
  if (!match) {
    return [];
  }
  return [`- 기존 ${topic.id} ${topic.title ?? ""} / 편람 흐름 ${match.id} ${match.title}. 같은 번호라도 합치지 않음.`];
});
lines.push(`기존 외부 표시 번호와 겹치는 항목 ${externalHits.length}개.`);
for (const line of externalHits) {
  lines.push(line);
}
lines.push("");
lines.push("원본 편람 전체가 재현된 것은 아닙니다.");
writeFileSync("docs/launcherbox-v6-validation.md", `${lines.join("\n")}\n`, "utf8");
console.log(`categories ${catalog.categories.length} topics ${catalog.topics.length} general ${general} broken ${linkBroken} chartFail ${chartFail} hash ${sourceHash === copyHash}`);

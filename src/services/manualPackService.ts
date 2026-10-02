import { replaceHandbookPack } from "./handbookFlowData";
import { replaceSection2 } from "./knowledgeService";
import { replaceManualRoot } from "./manualService";
import { replaceTopicFile } from "./topicService";

export interface VerifiedPack {
  handbook?: unknown;
  topics?: unknown;
  master?: unknown;
  epki?: unknown;
}

export function applyVerifiedPack(pack: VerifiedPack | null | undefined): void {
  if (!pack) {
    return;
  }
  if (pack.epki != null) {
    replaceManualRoot(pack.epki);
  }
  if (pack.topics != null) {
    replaceTopicFile(pack.topics);
  }
  if (pack.handbook != null) {
    replaceHandbookPack(pack.handbook);
  }
  if (pack.master != null) {
    replaceSection2(pack.master);
  }
}

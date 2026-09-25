import rawPack from "../data/handbookFlowPack.json";
import { readHandbookPack, type HandbookCatalog } from "./handbookFlow";

let cached: HandbookCatalog | null = null;

export function getHandbookCatalog(): HandbookCatalog {
  if (!cached) {
    cached = readHandbookPack(rawPack);
  }
  return cached;
}

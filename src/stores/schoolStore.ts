import { SAMPLE_SCHOOLS } from "../data/sampleSchools";
import type { SchoolItem } from "../types/school";

export function getSchools(): SchoolItem[] {
  return SAMPLE_SCHOOLS;
}

export function getSchoolById(id: string): SchoolItem | undefined {
  return SAMPLE_SCHOOLS.find((school) => school.id === id);
}

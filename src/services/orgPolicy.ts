import { invoke } from "@tauri-apps/api/core";

export interface OrgPolicy {
  disableAdminTools: boolean;
  disableDocumentIndex: boolean;
  disableStartupUpdate: boolean;
  disableStartupKnowledge: boolean;
}

const OPEN_POLICY: OrgPolicy = {
  disableAdminTools: false,
  disableDocumentIndex: false,
  disableStartupUpdate: false,
  disableStartupKnowledge: false,
};

let loaded: Promise<OrgPolicy> | null = null;

export function loadOrgPolicy(): Promise<OrgPolicy> {
  if (!loaded) {
    loaded = invoke<OrgPolicy>("org_policy_flags").catch(() => OPEN_POLICY);
  }
  return loaded;
}

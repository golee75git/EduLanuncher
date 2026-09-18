export interface DataSourceInfo {
  name: string;
  sourceUrl?: string;
  license?: string;
}

export interface SchoolItem {
  id: string;
  name: string;
  type: string;
  address?: string;
  phone?: string;
  homepage?: string;
  keywords?: string[];
  source?: DataSourceInfo;
}

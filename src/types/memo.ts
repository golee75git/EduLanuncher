export interface LocalMemo {
  text: string;
  updatedAt: string;
}

export const EMPTY_MEMO: LocalMemo = {
  text: "",
  updatedAt: "",
};

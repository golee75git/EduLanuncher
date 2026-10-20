/** 물품구매 시범 화면. 공식 금액·기한은 넣지 않는다. */
export const PURCHASE_GUIDE_HREF = "/menu/guide/purchase";

export const purchaseSteps = [
  { id: "budget", label: "예산 확인", note: "구매할 물품과 예산 편성 여부를 살펴봅니다. 예산 과목과 내부 승인 절차를 확인하세요." },
  { id: "draft", label: "품의 작성", note: "구매 목적·수량·규격 등 필요한 내용을 정리합니다. 품의 및 결재 방식은 적용 지침에 따릅니다." },
  { id: "quote", label: "견적 확인", note: "필요한 견적을 확보하고 금액·규격 등을 검토합니다. 비교견적 의무 여부는 계약기준 확인이 필요합니다." },
  { id: "contract", label: "계약", note: "검토된 방식에 따라 계약 또는 주문을 진행합니다. 계약 방식·절차·서류는 공식 규정을 확인하세요." },
  { id: "inspect", label: "검수", note: "납품 물품의 수량·규격·상태 등을 확인합니다. 실제 검수 절차와 담당자는 관련 규정에 따릅니다." },
  { id: "register", label: "물품등록", note: "취득한 물품 중 관리대상 물품의 등록 및 장부 정리를 검토합니다. 물품 유형별 요건을 확인하세요." },
  { id: "pay", label: "대금지급", note: "검수와 증빙자료 확인 이후 지출 절차를 검토합니다. 지급 요건은 해당 규정을 확인하세요." },
] as const;

export const purchaseConditions = [
  { id: "small", label: "소액 구매 검토", note: "소액 구매로 판단하려면 추정가격, 구매 목적, 계약의 성격 및 기관별 지침을 확인해야 합니다. 금액만으로 계약 방식을 단정하지 않습니다." },
  { id: "middle", label: "비교견적 필요 여부 검토", note: "복수 견적 제출 대상인지, 견적 비교 방법과 계약 체결 방식이 무엇인지 공식 계약 지침을 확인하세요." },
  { id: "large", label: "경쟁입찰 필요 여부 검토", note: "경쟁입찰 대상 여부, 조달 방식, 공고·심사 절차 및 예외 규정을 확인하세요. 특정 금액 이상이면 무조건 일반경쟁이라고 단정하지 않습니다." },
] as const;

export const purchaseChecks = [
  { id: "budget", label: "예산 편성 여부 확인" },
  { id: "draft", label: "품의 관련 서류 확인" },
  { id: "quote", label: "견적 자료 확인" },
  { id: "contract", label: "계약 방식·서류 확인" },
  { id: "inspect", label: "검수 자료 확인" },
  { id: "register", label: "물품등록 필요 여부 확인" },
  { id: "pay", label: "대금지급 증빙 확인" },
] as const;

export const purchaseRelated = [
  { id: "TOPIC-12-03", title: "계약의 방법", note: "계약 분야" },
  { id: "TOPIC-12-04", title: "수의계약", note: "계약 분야" },
  { id: "TOPIC-12-06", title: "물품계약", note: "계약 분야" },
  { id: "TOPIC-15-01", title: "물품의 취득·보관·운용", note: "물품 분야" },
] as const;

export const purchaseGlance = ["물품 선정", "품의", "구매·계약", "검수·등록", "대금지급"] as const;

import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1] / "src" / "data" / "troubleshooting"
files = sorted(ROOT.rglob("*.json"))
errors = []
cards = {}
paths = 0
for file in files:
    try:
        c = json.loads(file.read_text(encoding="utf-8"))
    except Exception as e:
        errors.append(f"{file}: JSON 오류 {e}")
        continue
    ident = c.get("id")
    if ident in cards:
        errors.append(f"{file}: 중복 ID {ident}")
    cards[ident] = c
    if file.stem != ident or file.parent.name != c.get("category"):
        errors.append(f"{ident}: 경로 불일치")
    if len(c.get("aliases", [])) < 5:
        errors.append(f"{ident}: 검색 표현 부족")
    if c.get("risk") not in ("safe", "caution", "danger"):
        errors.append(f"{ident}: 카드 위험도 오류")
    if c.get("environment") != ["personal", "organization"] or not c.get("organizationNotice"):
        errors.append(f"{ident}: 기관 안내 없음")
    if c.get("errorMessages") != []:
        errors.append(f"{ident}: 확인하지 않은 오류 메시지")
    if not c.get("sources") or any(
        not x.get("url", "").startswith("https://support.microsoft.com/") for x in c["sources"]
    ):
        errors.append(f"{ident}: 공식 출처 오류")
    q = {x["id"]: x for x in c.get("questions", [])}
    s = {x["id"]: x for x in c.get("solutions", [])}
    if len(q) != len(c.get("questions", [])) or len(s) != len(c.get("solutions", [])):
        errors.append(f"{ident}: 질문/해결책 ID 중복")
    if not q or not s:
        errors.append(f"{ident}: 진단 카드 누락")
        continue
    for node in q.values():
        if not 2 <= len(node.get("options", [])) <= 5:
            errors.append(f"{ident}: 선택지 수 오류")
        for opt in node["options"]:
            if opt.get("next") not in (set(q) | set(s) | {"support"}):
                errors.append(f"{ident}: 연결 오류 {opt}")
    for node in s.values():
        if node.get("nextIfUnresolved") not in (set(s) | set(q) | {"support"}):
            errors.append(f"{ident}: 후속 경로 오류 {node['id']}")
        if node.get("risk") == "danger" and (
            not any("백업" in p for p in node.get("prerequisites", []))
            or not any("BitLocker" in p for p in node.get("prerequisites", []))
        ):
            errors.append(f"{ident}: 위험 단계 사전 확인 누락")
        if not node.get("steps"):
            errors.append(f"{ident}: 절차 없음")

    def traverse(target, seen):
        global paths
        if target == "support" or (target in cards and target != ident):
            paths += 1
            return
        if target in seen:
            errors.append(f"{ident}: 순환 경로 {target}")
            return
        if target in q:
            for op in q[target]["options"]:
                traverse(op["next"], seen | {target})
        elif target in s:
            paths += 1
            traverse(s[target]["nextIfUnresolved"], seen | {target})
        else:
            errors.append(f"{ident}: 고립된 경로 {target}")

    start = c.get("questions", [{}])[0].get("id", "q1")
    traverse(start, set())
for ident, c in cards.items():
    for rel in c.get("related", []):
        if rel not in cards or rel == ident:
            errors.append(f"{ident}: 잘못된 관련 카드 {rel}")
    if len(c.get("related", [])) > 5:
        errors.append(f"{ident}: 관련 카드 5개 초과")
for category in ("network", "printer", "windows"):
    n = sum(x["category"] == category for x in cards.values())
    if n != 10:
        errors.append(f"{category}: 카드 {n}개")
if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)
print(f"PASS: JSON {len(files)}개, 중복/경로/참조/출처/위험 등급 검사 통과, 진단 분기 {paths}개 실행 (해결/지원 종료).")

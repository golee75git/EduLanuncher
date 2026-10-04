# 업무 카드 가상 자료

이 폴더는 실제 업무 자료가 아니다. `prototype/ai_launcherbox_handover/make_mock_data.py`가 만든 가상 공공기관 폴더만 들어 있다. 사람 이름, 실제 기관, 실제 문서는 없다.

## 폴더

`folder/`는 아래 명령으로 만들었다.

```bat
python prototype/ai_launcherbox_handover/make_mock_data.py src-tauri/fixtures/work-handover/folder
```

## 기대값

`expected.json`은 시제품을 AI 없이 한 번 돌린 `tasks.json`에서 절대 경로와 만든 시각을 뺀 것이다.

```bat
python prototype/ai_launcherbox_handover/handover_cards.py src-tauri/fixtures/work-handover/folder
```

`--llm-base`는 붙이지 않는다. 결과의 `files[].path`, `meta.source`, `meta.created`는 기대값에 넣지 않는다.

`months-without-mtime.json`은 같은 실행에서 수정일 단서의 가중치를 빼고 다시 계산한 월 목록이다.

Rust 테스트는 파이썬 없이 돈다. 비교 전에 각 파일의 수정일을 가상 스크립트와 같은 날짜(해당 날 10시)로 다시 맞춘다. 저장소에 있는 파일의 수정일은 복사하면서 바뀔 수 있으므로 기대값으로 쓰지 않는다.

비교 항목은 업무 이름, 묶인 파일의 상대 경로, 월, 주기 문장, 기한의 월·일·연·파일, 확신도이다. 주기 문장의 공백 차이는 허용한다. 기한 문장의 잘린 위치, 글자 수, 오류 문장은 비교하지 않는다. 월 집합, 확신도, 상대 경로가 다르면 실패이다. 수정일을 뺀 월 집합도 같이 본다.

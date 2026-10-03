# 기관 정책

앱은 이 레지스트리를 읽기만 한다. 쓰거나 등록하지 않는다. 아래 `.reg` 문장은 예시이며, 앱이 적용하지 않는다.

위치: `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\EduLauncher`

DWORD 값이 1이면 사용자 설정보다 먼저 끈다. 값이 없거나 0이면 사용자 설정을 따른다. 64비트 앱은 64비트 레지스트리 보기를 읽는다.

| 이름 | 1일 때 |
|---|---|
| DisableAdminTools | IP 검색·CCTV 검색을 열지 않는다 |
| DisableDocumentIndex | 문서 색인과 검색을 하지 않고 원본도 열지 않는다. 기존 색인 파일은 지우지 않는다 |
| DisableStartupUpdateCheck | 시작할 때 새 버전을 확인하지 않는다 |
| DisableStartupKnowledge | 시작할 때 업무자료를 받지 않는다. 이미 받은 자료는 그대로 연다 |

```
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\EduLauncher]
"DisableAdminTools"=dword:00000001
"DisableDocumentIndex"=dword:00000001
"DisableStartupUpdateCheck"=dword:00000001
"DisableStartupKnowledge"=dword:00000001
```

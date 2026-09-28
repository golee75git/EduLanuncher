# 문서 검색에 넣은 패키지

라이선스 파일은 이 PC의 crates.io 패키지에서 확인했다. GPL/AGPL은 없다.

| 패키지 | 버전 | 라이선스 | 쓰는 이유 |
| --- | --- | --- | --- |
| rusqlite | 0.40.2 | MIT | 이 PC에만 두는 본문 색인 |
| SQLite (rusqlite bundled) | 3.53.2 | 공개 도메인 | FTS5. 저작권 포기를 소스 머리말에서 확인 |
| zip | 8.6.0 | MIT | HWPX, DOCX, XLSX 압축을 읽음. deflate만 켬 |
| quick-xml | 0.42.0 | MIT | 그 압축 안 XML의 글자만 읽음 |
| flate2 | 1.1.10 | MIT OR Apache-2.0 | zip의 deflate가 데려옴 |
| zlib-rs | 0.6.8 | zlib 허가 문장 | flate2가 데려옴 |
| zopfli | 0.8.3 | Apache-2.0 | zip이 데려옴. COPYING에서 확인 |

lopdf 0.45.0(MIT)은 이미 있던 PDF 도구와 같다. 암호 해제는 호출하지 않는다.
글꼴 파일을 넣지 않았다. 화면 글꼴은 Windows 기본 글꼴이다.

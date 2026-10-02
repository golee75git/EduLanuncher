# 업무자료 서명

이 문서는 키를 다루는 순서이다. 라이선스 준수를 보장하지 않으며, 법적 검토가 아니다. 특허 비침해를 보장하지 않는다.

서명은 런처만 보호한다. 브라우저로 여는 사이트 페이지(검색 결과의 `menu/topic` 등)는 보호하지 않는다. 사이트, Cloudflare, GitHub 계정의 2단계 인증과 도메인 자동 갱신이 필요하다.

## 전환 순서

1. 이 PC에서 서명 키를 만든다. 저장소, CI 로그, 클라우드 동기화 폴더에 두지 않는다. USB처럼 오프라인으로 보관한다.
2. 공개키만 앱 상수에 넣는다. `src-tauri/src/knowledge_sign.rs`의 `PUBLIC_KEYS_B64`이다. 최대 2개(현재, 다음)이다.
3. 사이트에 서명된 업무자료를 배포한다. 0.1.159 이하는 서명을 보지 않으므로, 사이트 서명을 먼저 올려도 기존 사용자에게 영향이 없다.
4. 서명 검증이 들어 있는 런처를 릴리스한다.

잘못 올린 자료는 비워서 내리지 못한다. 빈 manifest는 런처가 성공으로 보되 설치본과 기존 캐시를 지우지 않는다. 고친 자료를 새로 서명해 올려야 한다.

## 키 만들기

OpenSSL:

```bat
openssl ecparam -name prime256v1 -genkey -noout -out knowledge-signing-key.pem
```

Node.js:

```bat
node -e "const c=require('crypto');const fs=require('fs');const p=process.env.KNOWLEDGE_SIGNING_KEY_PATH;if(!p){process.exit(1)}const k=c.generateKeyPairSync('ec',{namedCurve:'P-256'});fs.writeFileSync(p,k.privateKey.export({type:'pkcs8',format:'pem'}))"
```

환경 변수 `KNOWLEDGE_SIGNING_KEY_PATH`에 키 파일 경로를 넣는다. 파일 이름은 `knowledge-signing`으로 시작하고, `.pem`, `.key`, `.p8`은 git에 들어가지 않는다.

공개키만 출력한다. 개인키 내용과 경로는 출력하지 않는다.

```bat
node website/scripts/show-knowledge-public-key.mjs
```

나온 한 줄을 `PUBLIC_KEYS_B64`에 넣는다. 65바이트 비압축 점(`0x04||X||Y`)의 표준 base64이다. 서명 파일은 raw `r||s` 64바이트의 표준 base64이다.

## 사이트 작업 순서

```bat
cd website
npm run deploy
```

순서는 빌드, 서명, `wrangler deploy`이다. 서명 키가 없거나 서명이 실패하면 배포하지 않는다.

서명 대상은 런처가 받는 파일만이다.

- `catalog.json`
- `search-index.json`
- `pack/handbook.json`
- `pack/topics.json`
- `pack/master.json`
- `pack/epki.json`

사이트 화면용 `/knowledge/handbook.json` 같은 루트 파일은 서명하지 않는다.

일련번호는 서명한 시각의 UTC 유닉스 초이다. 별도 기록 파일은 없다. `generatedAt`은 표시용이며 런처는 갱신 판단에 쓰지 않는다.

manifest 경로는 위 파일만 허용한다. `..`, 절대 경로, 쿼리, 다른 폴더는 런처가 거부한다. 파일 수는 8개까지이다.

## 허용 도메인 추가

허용 목록은 `src-tauri/src/knowledge_sign.rs`의 `LINK_HOSTS` 한 곳이다. 도메인을 더하려면 그 상수를 고친 뒤 앱을 다시 빌드해 배포한다. 업무자료 파일은 이 목록을 바꾸지 못한다.

`https`만 허용한다. 호스트가 목록과 같거나 그 하위 도메인일 때만 허용하고, 접미사 경계로 비교한다. `ms-settings:`를 포함한 다른 스킴은 무시한다.

앱 코드에 고정된 주소(`KNOWN_SITE_URL` 등)는 이 검사의 대상이 아니다.

## 키 교체

1. 새 키를 만든다.
2. 새 공개키를 `PUBLIC_KEYS_B64`의 두 번째 칸에 넣고 앱을 배포한다. 옛 키로 서명한 자료도 받는다.
3. 이용 중인 앱이 그 버전으로 바뀐 뒤, 사이트 서명을 새 키로 바꾼다.
4. 다음 앱에서 옛 공개키를 뺀다.

키를 잃으면 새 키를 만들어 같은 순서로 앱을 먼저 배포한다. 옛 서명 자료는 새 앱이 받기 전까지 유지된다.

## 향후 과제

검색 결과를 사이트 페이지 대신 런처 안에서 검증된 자료로 보여주는 방식을 검토한다.

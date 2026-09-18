# EduLauncher (교육업무 런처) V0.1

Windows용 교육기관 업무 런처입니다. 평소에는 시스템 트레이에만 있고, 트레이 클릭 또는 `Ctrl + Alt + E`로 작은 패널을 엽니다.

## 실행

Visual Studio 2022 Build Tools(C++)가 필요합니다.

```bat
tauri-env.cmd dev
```

또는 개발자 명령 프롬프트에서:

```bat
npm run tauri dev
```

첫 실행 시 환영 화면이 나타납니다. 이후에는 트레이 아이콘만 남습니다.

## 빌드

```bat
tauri-env.cmd build
```

설치 파일:

`src-tauri/target/release/bundle/nsis/EduLauncher_0.1.0_x64-setup.exe`

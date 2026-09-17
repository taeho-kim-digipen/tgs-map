# TGS 2026 지도 — Codex 이관본

**최신: 멧세 전체 지도·위치·부스 경로 안내.** 사용법과 근사 정합/현장 검증 범위는 [NAVIGATION.md](NAVIGATION.md)를 참고하세요. 부스 더블탭으로 안내를 시작/해제하며, 1–8홀에서 9–11홀까지 연결교를 포함합니다.

**여행용 중간 완성본 v2:** iPhone 설치·오프라인 사용·관심 목록 백업은 [`TRAVEL_START_HERE.md`](TRAVEL_START_HERE.md)를 먼저 읽으세요.

9–11홀과 인디 확대도를 포함한 공식 도면 7개, 부스 557개를 지원합니다. 휴대전화 전시관·편의시설 메뉴는 하단에 있습니다. 부스 모서리의 게임패드·티켓·쇼핑백 아이콘으로 확인된 시연·정리권·판매 정보를 구분합니다. 부스 상세에 전시 내용·굿즈·판매 조건과 공식 출처를 제공합니다. 현재 34개 부스에 조사 또는 공식 상품판매 구역 정보가 있으며, 나머지는 미확인으로 표시합니다.

이 폴더는 이미 구현·배포된 지도 소스와 후속 작업 맥락을 담은 독립 실행용 사본입니다.
대화 세션이나 로그인 권한을 자동 이전하는 파일은 아닙니다.

## Windows에서 이어서 개발

1. ZIP을 압축 해제합니다.
2. Codex에서 이 `tgs-2026-map` 폴더를 작업 폴더로 엽니다. VS Code의 Codex를 사용해도 같은 폴더를 엽니다.
3. `START_HERE.txt`의 내용을 첫 메시지로 전달합니다.
4. Codex가 `AGENTS.md`, `handoff/HANDOFF.md`를 읽고 로컬 실행부터 확인하도록 합니다.

공식 사용 안내: https://learn.chatgpt.com/docs/app

## 실행

Node.js 20 이상이 있는 경우, 프로젝트 루트에서:

```sh
npm run dev
```

http://127.0.0.1:5173 에서 확인합니다. 외부 패키지가 없어 `npm install`은 필요하지 않습니다.
`dist/`가 완성된 정적 웹앱이며 별도 빌드 단계가 없습니다.
`index.html`을 파일로 직접 열면 데이터 fetch가 차단될 수 있으므로 HTTP 서버로 실행합니다.

### iPhone과 동시에 확인

PC와 iPhone을 같은 Wi-Fi에 연결하고 다음 명령을 실행합니다.

```sh
npm run dev:phone
```

실행 창에 표시되는 휴대전화 접속 주소를 iPhone Safari에서 엽니다.
Windows에서는 `START_PHONE_TEST.cmd`를 더블클릭해도 같은 서버가 시작됩니다.
지도 앱 파일을 저장하면 열린 페이지가 자동으로 새로고침됩니다.
개발용 새로고침 코드는 서버 응답에만 추가되며 `dist/` 원본에는 저장되지 않습니다.
일반 `npm run dev`는 PC 전용 접속을 유지합니다.
자세한 연결·사용 방법은 [`handoff/PHONE_TESTING.md`](handoff/PHONE_TESTING.md)를 참고하세요.

Python이 설치되어 있다면 대체 실행:

```sh
python -m http.server 5173 --bind 127.0.0.1 --directory dist
```

## 기존 자동 검증

```sh
npm test
```

기존 모의 DOM 테스트를 이식했습니다. 실제 브라우저·iPhone·iOS 시뮬레이터 테스트가 아닙니다.

2026-09-11 Codex 로컬 실행, 브라우저 화면 확인 및 화면 방향 수정 결과는
[`handoff/LOCAL_VALIDATION.md`](handoff/LOCAL_VALIDATION.md)에 기록했습니다.

## 폴더 안내

- `dist/`: 실제 HTML/CSS/JavaScript, 원본 기반 SVG 지도 7개, 부스·시설 JSON.
- `sources/booth-details.json`: 개별 조사한 전시·시연·정리권·굿즈·판매 정보와 공식 출처.
- `scripts/extend-halls.py`: 원본 PDF 2쪽에서 9–11홀·인디 확대도와 부스 좌표를 추출합니다. PyMuPDF와 lxml이 필요합니다.
- `scripts/build-booth-details.cjs`: 조사 원본과 공식 상품판매 구역 정보를 지도 JSON에 병합합니다.
- `sources/2026TGS_MAP_EN.pdf`: 공식 원본 PDF.
- `extract_map.py`: 원본 PDF에서 지도·좌표를 추출한 스크립트. 일반 실행에는 필요 없습니다. 재생성에는 PyMuPDF와 lxml이 필요합니다.
- `tests/`: 기존 기능 검증.
- `handoff/HANDOFF.md`: 요구사항, 완료/미완료, 기술 사항, 배포 정보와 다음 작업.
- `handoff/source-manifest.json`: 원본 커밋과 각 원본 파일의 SHA-256.
- `handoff/original-hosting.json`: 이전 호스팅 설정의 참고용 사본. 로컬 서버는 사용하지 않습니다.

AR·GPS·실내 경로·네이티브 iOS 앱은 아직 구현하지 않았습니다.
현재 사이트에 저장된 개인 관심 부스는 브라우저 localStorage 데이터이므로 이 ZIP에 들어 있지 않습니다.
로컬 주소에서 열면 별도의 저장 공간을 사용하며 기본 관심 부스 3개로 시작합니다.

# 이관본 검증 결과

2026-09-11, Linux / Node.js v24.19.0에서 확인.

- `node tests/check-interactions.cjs`: PASS. package.json의 `npm test`가 실행하는 동일 스크립트.
- `node --check scripts/serve.cjs`: PASS.
- `node --check dist/app.js`: PASS.
- 임시 로컬 포트에서 Node 서버를 실제 실행하고 HTML, JS, CSS, JSON, SVG 3개를 HTTP로 받아 디스크 원본과 바이트 일치 확인: PASS.
- 원본 Git 커밋의 추적 파일 12개가 이관본에 바이트 단위로 보존됐는지 확인: PASS.
- 원본 README, .gitignore, hosting 설정은 handoff/ 아래에 참고용 원본으로 보존.
- 테스트 스크립트의 Linux 고정 경로는 이관본 폴더 기준 상대 경로로 변경.

Windows 실기기, Safari, iPhone, iOS 시뮬레이터, AR 센서는 이 검증에 포함되지 않았다.

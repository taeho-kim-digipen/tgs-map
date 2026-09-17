# Codex 로컬 실행 점검 — 2026-09-11

이후 같은 Wi-Fi의 iPhone 접속과 개발 중 자동 반영 기능을 추가했고, 사용자에게 iPhone에서 지도 열림을 확인받았다. 최신 연결 방법과 검증 범위는 [PHONE_TESTING.md](PHONE_TESTING.md)를 참고한다. 아래 내용은 최초 이관 점검 시점의 기록이다.

## 실행 환경

- Windows, Node.js v24.11.1, npm 11.6.2.
- `npm run dev` 실행 성공. 주소: http://127.0.0.1:5173/
- 추가 패키지 설치 없이 기존 `dist/`를 사용했다.
- `npm test`는 수정 전과 수정 후 모두 통과했다. 아래에 추가한 회귀 테스트는 코드 수정 전 실패하는 것을 먼저 확인했다.
- 이번 세션에서 Codex 내장 브라우저로 실제 HTML/CSS/SVG 화면을 확인했다. iPhone Safari 또는 iOS Simulator 실행은 아니다.

## 발견 및 수정

`dist/app.js`가 `screen.orientation`을 우선해, 가로 모니터에서 창을 430×932로 줄여도 가로 모드를 선택했다. 브라우저에서 이를 재현했으며 화면 모드 선택 상자의 오른쪽이 434px까지 나와 430px 창을 벗어났다.

방향 판단을 레이아웃 뷰포트(`window.innerWidth`, `window.innerHeight`) 기준으로 수정했다. 사용 가능한 크기는 계속 `visualViewport`를 사용한다. 키보드로 visual viewport 높이만 줄어들 때 방향은 유지한다. 수정 후 세로 모드가 선택되고 안내 버튼도 오른쪽 416px 이내에 표시됐다.

`tests/check-interactions.cjs`에는 모니터와 창 방향 불일치, 키보드에 따른 visual viewport 높이 변화, 기존 강제 회전 동작 검증을 추가했다. 실제 iOS 키보드 동작은 별도 확인이 필요하다.

## 브라우저에서 확인한 결과

| 항목 | 결과 |
|---|---|
| 자동 세로 430×932 | 세로 배치, 페이지 크기 430×932 |
| 자동 가로 932×430 | 가로 배치, 페이지 크기 932×430 |
| 자동 PC 1440×900 | PC 배치, 페이지 크기 1440×900 |
| 세로 창에서 강제 가로 | 90° 회전 후 전체 앱이 430×932 안에 배치 |
| 메인 지도 | 공식 SVG 및 관심 부스 표시 |
| 학교 코너 | 별도 도면 렌더링 및 부스 요소 67개 확인 |
| 번호 검색 | `7-c4` → NEXON 07-C04 상세 이동 |
| 한국어 검색 | `캡콤` → CAPCOM 07-S01 |
| 편의시설 검색 | `보관함` → 결과 5개, 동측 입구 보관함 선택 시 2F 센트럴몰 이동 |
| 관심 부스 저장 | 페이지 WebMCP로 캡콤 추가 → 4개, 새로고침 후 4개 복원 확인 |
| 관심 부스 해제 | 화면의 해제 버튼으로 캡콤 제거 → 기존 3개 복원 |
| 브라우저 경고·오류 로그 | 조회한 로그에서 없음 |

화면 기록: [세로](validation/portrait.png), [가로](validation/landscape.png), [PC](validation/pc.png), [강제 가로 회전](validation/forced-landscape.png).

500ms 길게 누르기, 드래그·핀치·취소, 빈 관심 목록 저장, 전체 부스 227개·시설 48개의 좌표 범위는 기존 모의 DOM 테스트로 검증했다. 실제 터치 하드웨어, Safari safe area, 카메라, GPS, 현장 AR 검증을 뜻하지 않는다.

## 현재 iOS 도구 확인

- 현재 PATH에서 `swift`, `xcodebuild`, `xcrun`, `idevice_id`를 찾지 못했다.
- 현재 호출 가능한 연결 도구 목록에 iOS 빌드·Simulator·실기기 제어 도구가 없었다. PC 전체의 설치 목록이나 물리 기기 연결 여부를 확인했다는 뜻은 아니다.
- Apple 공식 Xcode는 macOS 실행 환경이 필요하다. [Apple Xcode 시스템 요구사항](https://developer.apple.com/xcode/system-requirements/)
- ARKit은 iOS Simulator에서 지원되지 않아 실제 AR 추적 검증에는 실기기가 필요하다. [Apple ARKit 실행 조건](https://developer.apple.com/documentation/arkit/tracking-and-visualizing-planes)

## 다음 구현을 위한 조건

1. iPhone에서 접속할 수 있는 테스트 주소를 마련한다. 현재 서버는 PC의 `127.0.0.1`에만 연결되므로 휴대전화에서 직접 접근할 수 없다.
2. 카메라·위치 실험에는 HTTPS와 사용자 권한을 전제로 한다. PC의 localhost 예외를 휴대전화에서 여는 PC의 HTTP 주소에 적용하면 안 된다. [W3C Secure Contexts](https://www.w3.org/TR/secure-contexts/)
3. 먼저 iPhone Safari에서 지도·저장·회전·키보드 배치와 센서 권한·정확도를 확인한다. 이 검증 순서는 웹 AR 방식의 최종 선택을 의미하지 않는다.
4. 네이티브 방식을 선택하면 Mac/Xcode 실행 환경과 서명·설치 경로를 확보한다. 현재 세션에서 사용할 수 있다고 확인된 환경은 없다.
5. 실제 위치 기반 경로 구현에는 공식 도면과 실제 좌표의 정합 및 통로·층간 연결 데이터가 더 필요하다. 임의 위치나 직선을 실제 실내 경로로 표시하지 않는다.

AR·GPS·경로·네이티브 앱 구현 방식은 계속 미확정이다. 이번 작업에서 기존 배포를 갱신하거나 공개 범위를 바꾸지 않았다.

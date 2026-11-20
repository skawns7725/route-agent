Last-Author: Codex

## 2026-11-20 GPS 출발지 보정과 홈 화면 2단계

- `routing.js`, `driving.mjs`에서 실제 주행 시작 직전 임시 GPS 출발지만 다시 확인한다. 정확도 100m 이내이고 이동 거리 100m 초과일 때 선택한 경로 옵션과 경유지를 유지해 다시 조회한다. 위치 확인이나 경로 조회에 실패하면 기존 경로로 안내한다.
- `gps-departure.mjs`, `gps-departure.test.mjs`, `simulation.js`, `serve.cjs`에서 거리 계산을 공유하고 보정 기준을 단위 테스트한다.
- `route-agent-demo.html`, `map.css`, `app.js`, `place-search.mjs`에서 검색·마이크·기온을 지도 위에, 빠른 목적지를 지도 아래에 배치했다. 기온과 소요 시간은 예시값이다. 집은 저장된 장소를 사용한다.
- `node --test` 40개, 변경 JS 구문 검사, `git diff --check` 통과. 코드 검토로 주행 진입점을 확인했다. 브라우저와 실기기 GPS 검증은 생략했고 시안 원본은 제공되지 않았다.
- 다음 작업은 PR 리뷰다. 이전 운영 이슈는 `docs/CODESPACES_RECOVERY.md`와 Git 이력을 참고한다.

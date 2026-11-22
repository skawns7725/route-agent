Last-Author: Codex

## 2026-11-22 문자 아이콘을 SVG로 교체

- 목표는 `main`의 `64af23c`에서 분기한 `codex/icon-images`에 제공된 아이콘을 적용하는 것이다.
- `icons/`에 원본 SVG 8개를 추가했다. `route-agent-demo.html`의 사이드바, 패널 제목, 검색 마이크, 줌, 오프라인 예시 아이콘을 인라인 SVG로 바꾸고 검색창에 돋보기를 넣었다.
- SVG 8개의 원문 바이트 비교, `node --test` 51개, `git diff --check`를 통과했다. 로컬 Chromium에서 Light·Color·Dark 테마 각각 14곳의 SVG 표시와 색상 상속, 검색창 아이콘 위치를 확인했다.
- 카카오 지도 키가 없는 환경에서 줌 컨트롤과 실제 GPS 패널은 테스트 중 표시 상태만 열어 확인했다. 실제 지도 연동과 GPS 주행은 미검증이다.
- 다음 작업은 `main` 대상 PR 검토다. 별도 실제 신호 아이콘 작업과 실기기 GPS 출발지 교정·이탈 재탐색 검증이 남아 있다. 기존 운영 이슈는 `docs/CODESPACES_RECOVERY.md`를 참고한다.

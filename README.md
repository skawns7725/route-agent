# Route Agent

## 개발 도구 시작점

- Codex는 `AGENTS.md`를 따른다.
- Claude Code는 `CLAUDE.md`에서 같은 지침을 불러온다.
- Google AI Studio는 저장소에 연결한 뒤 프로젝트의 지속 지침을 설정할 수 있는 곳에 아래 문장을 한 번 등록한다. 저장소를 읽을 수 없는 환경에서는 프로젝트 문맥에 `AGENTS.md`를 추가한다. 이후 작업 요청에는 목표만 적으면 된다.

> 이 프로젝트에서는 Google AI Studio로 작업한다. 작업 전 저장소 루트의 AGENTS.md를 읽고 따른다. 코드 변경 또는 장애 진단을 마칠 때마다 같은 작업 결과에 WORK-HANDOFF.md 갱신을 포함한다. 파일 쓰기가 불가능하면 변경 패치를 결과에 포함한다.

## Codespaces 지도 확인

서버는 `node serve.cjs`로 실행하며 기본 포트는 8080이다. 앱은 `KAKAO_MAP_JAVASCRIPT_KEY`를 사용해 지도를 자동 로딩한다. 자동차 경로 조회에는 별도의 `KAKAO_MOBILITY_REST_KEY`가 필요하다.

Codespaces 미리보기에서 지도가 뜨지 않으면 해당 Codespace의 터미널에서 실행 중인 서버 설정을 확인한다. 아래 명령은 키 값을 출력하지 않는다.

```sh
git rev-parse --short HEAD
node -e 'fetch("http://127.0.0.1:8080/api/map-config").then(async r => { console.log("HTTP", r.status); if (r.ok) console.log("Map JavaScript key configured:", Boolean((await r.json()).javascriptKey)); }).catch(e => { console.error(e.message); process.exitCode = 1; })'
```

- 서버에 연결할 수 없으면 8080에서 Node가 실행 중인지 확인한다. HTTP 404면 최신 `main`의 서버 코드가 실행 중인지 확인한다.
- HTTP 200이고 `false`면 시크릿의 대상 저장소와 Codespace 재시작 여부를 확인한다.
- HTTP 200이고 `true`면 브라우저 개발자 도구에서 카카오 SDK 요청 오류를 확인한다. 키 종류, 카카오맵 활성화, 미리보기 도메인 등록 여부를 오류 내용에 따라 확인한다. 로그를 공유할 때 SDK 요청 URL의 `appkey` 값은 가린다.

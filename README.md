# Route Agent

## 전체 화면 지도

`node serve.cjs`로 실행한 뒤 `http://127.0.0.1:8080`에서 연다. 지도 연결 없이 화면의 **예시 주행**을 바로 재생할 수 있다. 카카오 지도와 길찾기를 쓰려면 각각 `KAKAO_MAP_JAVASCRIPT_KEY`, `KAKAO_MOBILITY_REST_KEY`를 서버 환경변수로 설정한다.

- **경로**에서 GPS로 출발지를 잡거나 장소를 검색한다. 빠른 길·짧은 길은 카카오 경로 우선순위에 따라 조회한다. 정체 적은 길은 교통 상태를 확인할 수 있는 후보 중 정체·지체·통행 불가 거리 비율로 비교한다. 무료도로는 통행료 0원이 확인된 후보에서 고른다. [카카오모빌리티 자동차 길찾기](https://developers.kakaomobility.com/guide/navi-api/directions.html)
- **실제 신호**에서 대전 시설과 전국 교차로 신호를 조회한다. 오래되거나 응답이 없는 신호는 확인 불가로 표시한다.
- **모의 주행**에서 선택한 도로 경로 또는 예시 경로를 재생한다. 시험 신호와 주행 시간은 가상 값이며 재생 배속과 독립적이다. 휴대폰에서는 주행 시작 시 패널이 접히며 다시 열면 교차로별 대기와 결과를 볼 수 있다.
- **음성 안내**에서 선택한 경로 요약을 읽거나 예시 주행을 시작한다. 마이크가 제한된 환경에서는 텍스트 명령을 사용할 수 있다.

회귀 테스트는 `node --test`로 실행한다.

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

## 신호등 정보

서버에 `TRAFFIC_SIGNAL_SERVICE_KEY`를 설정하고 `node serve.cjs`로 실행한다. 같은 공공데이터포털 계정으로 두 서비스의 활용 승인을 받으면 공통 인증키를 사용할 수 있다.

- 대전은 자치구와 주소, 도로명 또는 관리번호로 신호등을 찾아 설치 위치와 시설 정보를 확인할 수 있다. [대전광역시 신호등조회서비스](https://www.data.go.kr/data/15110706/openapi.do)
- 나머지 지역은 제공되는 교차로의 방향별 신호 상태, 집계·조회 시각과 잔여시간을 표시한다. 집계 시각에서 15초가 지나면 신호 상태와 잔여시간 대신 확인 불가 상태를 표시한다. [전국 교통안전 신호등 실시간 정보](https://www.data.go.kr/data/15157604/openapi.do)
- 지도 위치를 보려면 카카오 지도 JavaScript 키도 필요하다. 신호등 목록과 상세 정보는 서버 키만으로 조회할 수 있다.

서버 회귀 테스트는 `node --test traffic-signals.test.cjs`로 실행한다.

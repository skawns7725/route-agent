# Codespaces 미리보기 복구

| 증상 | 확인할 곳 | 조치 |
| --- | --- | --- |
| 외부 URL의 404와 원격 편집기의 `Starting codespace` | GitHub Codespaces 목록과 원격 연결 상태 | 기존 Codespace를 열고 원격 연결이 끝날 때까지 기다린다. |
| Ports에 8080이 있으나 프로세스가 없음 | 원격 터미널의 `ss`와 루프백 | 저장소 루트에서 시작 스크립트를 실행하고 앱 HTML이 나오는지 확인한다. |
| `EADDRINUSE` | 8080 리스너와 프로세스의 작업 디렉터리 | 같은 앱이 정상 응답하면 기존 서버를 사용한다. 다른 서비스가 포트를 쓰면 소유자를 확인한다. |
| 루프백과 인증된 터널은 200, 외부 브라우저는 404 | Ports의 주소·가시성, 브라우저 로그인, 프록시 인증 | 같은 계정으로 Ports의 **브라우저에서 열기**를 시도한다. 필요하면 이미 승인된 비공개 로컬 전달을 사용한다. |
| 공개 포트인데 외부 브라우저는 404 | Codespace 내부와 접속 기기에서 동일 HTTPS 주소의 상태 코드 및 `X-Served-By` 헤더 비교 | 서로 다른 전달 서버에서 200과 404가 나오면 앱 프로세스와 별개로 기록한다. 전달 재등록이나 재활성화 이후에도 브라우저에서 결과를 확인한다. |
| 앱은 열리지만 새 기능이 없음 | 원격 브랜치·커밋·기능 모듈의 응답 | 작업 트리에 미커밋 변경이 있는지 확인한 뒤 승인된 버전을 반영한다. |

원격 터미널에서 초기 상태를 확인한다.

```bash
git status --short --branch
git rev-parse --short HEAD
ss -ltnp 'sport = :8080'
bash .devcontainer/start-preview.sh
```

시작 스크립트는 정상 서버를 재사용하고 잠금으로 동시 시작을 막는다. 실패 시 임시 디렉터리의 로그 경로를 표시한다. 기존 구성의 `postAttachCommand`는 편집기에 연결할 때마다 서버를 실행했다. 새 구성은 컨테이너 시작 시 실행한다. 구성 변경이 반영된 컨테이너에서는 편집기 재연결이 서버를 다시 실행하지 않는다.

`route-agent-codespace-recovery` 스킬의 검사 스크립트는 앱 HTML과 카카오 JS 키의 설정 여부를 요약한다. 비공개 터널은 해당 Codespace 안에서 인증 검사하고, 브라우저 화면은 별도로 확인한다. 기록에는 포트 가시성을 적고 토큰과 시크릿 값은 제외한다.

## 전달 리전별 응답이 다를 때

같은 공개 주소가 한 네트워크에서 404, 다른 네트워크에서 200이라면 두 네트워크의 DNS 결과와 `X-Served-By`를 확인한다. 정상 응답을 반환한 쪽에서 실제로 확인한 IP로, 영향받는 기기에서 요청 단위의 테스트를 할 수 있다. 아래 변수에는 Ports에서 확인한 호스트와 바로 검증한 IP를 넣는다.

```bash
curl --silent --show-error --max-time 10 --resolve "${preview_host}:443:${verified_edge_ip}" \
  --output /dev/null --write-out '%{http_code}\n' "https://${preview_host}/"
```

HTTPS 인증서 검증을 유지한다. 200일 때 앱 HTML과 카카오 SDK 연결을 확인한다. 긴급 미리보기는 별도 Chromium 프로필에서 해당 호스트에만 `--host-resolver-rules`를 적용할 수 있다. 적용한 IP가 바뀌면 다시 확인하고, 일반 DNS에서 열리면 복구 프로필을 닫는다. 일반 경로의 404는 서비스 제공자 쪽 복구가 필요한 별도 상태로 기록한다.

[GitHub Codespaces 포트 전달](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace) · [Dev Container 시작 훅](https://github.com/devcontainers/spec/blob/main/docs/specs/devcontainerjson-reference.md)

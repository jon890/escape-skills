# escape-skills

KeyEscape(키이스케이프) 방탈출 예약 자동화. stealth Chrome(rebrowser-playwright) 위에서
예약 페이지의 가용 시간을 조회하고 예약 정보를 자동 입력한다.

## 3단계 워크플로

1. **조회** — 예약 가능 날짜/시간 리포트(주말 우선)
2. **입력** — config의 예약자 정보로 STEP 2 자동 입력
3. **마무리** — reCAPTCHA·예약하기·무통장입금은 사람이 직접

reCAPTCHA와 무통장입금(금전) 때문에 최종 제출은 의도적으로 자동화하지 않는다.
"결제 직전 금액·내용 확인 후 승인" 원칙을 코드 레벨에서 보장한다.

## 설치

```bash
npm install
cp reservation.config.example.json reservation.config.json
# reservation.config.json 에 예약자 정보(이름·연락처·인원)를 채운다 (gitignore 됨)
```

## 사용

```bash
npm run dev -- query                      # 1단계: 가용 날짜/시간 조회 (주말 우선)
npm run dev -- reserve                     # 2단계: 주말 우선 첫 슬롯에 정보 자동입력
npm run dev -- reserve 2026-06-23 09:40    # 날짜/시간 지정
```

가용 슬롯이 있으면 브라우저를 닫지 않고 유지한다(Ctrl+C로 종료). 예약을 이어서
진행하기 위함이다.

## 설정 (reservation.config.json)

| 키 | 의미 |
|---|---|
| `themeUrl` | 예약 페이지 URL (지점·테마 지정) |
| `reserver.person` | 인원 (2~6) |
| `reserver.name` | 예약자명 (입금자명과 동일해야 확정) |
| `reserver.phone` | 연락처 (`010-1234-5678`) |
| `agreements` | 약관 동의 (privacy·payment 필수, marketing 선택) |
| `preferences.preferWeekend` | 주말 우선 정렬 여부 |
| `preferences.dates` | 조회 대상 날짜 제한 (비우면 오픈 전체) |

## 구조

- `keyescape.ts` — 핵심 로직(조회·정렬·선택·입력·요약). import 해서 재사용 가능.
- `index.ts` — CLI(query · reserve).
- `stealth-template.mjs` — 봇 탐지 저항 브라우저 팩토리.
- `.claude/skills/keyescape-reservation/` — Claude Code 스킬 정의.

## 두 실행 환경

- **cmux 환경**: cmux 브라우저로 즉석 조회·입력.
- **순수 Playwright 환경**(cmux 없는 사용자): 이 repo의 `npm run dev`.

## 주의

인증된 사용에 한한다. 사이트 약관·robots.txt·관련 법을 준수한다.
헤드리스 모드는 봇 탐지에 걸리기 쉬워 기본 headed를 유지한다. reCAPTCHA는 사람이 푼다.

---
name: keyescape-reservation
description: >
  KeyEscape(키이스케이프) 방탈출 예약을 Playwright(stealth Chrome)로 자동화한다.
  "키이스케이프 예약", "방탈출 예약", "keyescape 예약 잡아줘", "예약 가능한 시간 조회",
  "이번주 토요일 방탈출", "예약 자동화", "방탈출 자리 있나 확인" 같은 요청이면 — 명시적으로
  스킬 이름을 말하지 않아도 — 이 스킬을 사용한다. 3단계로 동작한다: (1) 예약 가능 날짜/시간
  리포트(주말 우선), (2) config의 예약자 정보로 STEP 2 자동 입력, (3) reCAPTCHA·예약하기·입금은
  사람이 직접. cmux 브라우저 환경과 cmux 없는 환경(순수 Playwright) 양쪽 모두 지원한다.
  단순 웹 검색이나 다른 예약 사이트에는 쓰지 않는다 — KeyEscape 예약 전용이다.
---

# KeyEscape 예약 자동화

KeyEscape 예약 페이지(`reservation1.php`)의 실제 DOM/AJAX 흐름을 그대로 따라
가용 시간을 조회하고 예약 정보를 자동 입력한다. 결제(무통장입금)를 부르는 최종
제출은 의도적으로 사람이 한다.

> 이 스킬은 escape-skills repo 안에서 관리된다(`.claude/skills/keyescape-reservation/`).
> 코드는 repo 루트에 있으므로 아래 `npm run dev ...` 명령은 모두 **repo 루트에서** 실행한다.
> 가용 슬롯이 있으면 브라우저를 닫지 않고 Ctrl+C 까지 유지한다(예약을 이어서 진행하기 위함).

## 핵심 원칙 — 왜 사람이 마지막을 누르는가

예약 페이지 STEP 2 에는 **reCAPTCHA**(자동등록방지)와 **무통장입금** 결제가 있다.
reCAPTCHA 는 사람을 요구하고, 입금은 환불·확정이 걸린 금전 행위다. 그래서 이 스킬은
**STEP 2 정보 입력까지만** 자동화하고, reCAPTCHA·`예약하기` 클릭·입금은 사람에게 넘긴다.
이는 "결제 직전 금액·내용을 확인하고 승인 후에만 진행" 원칙을 코드 레벨에서 보장한다.

## 3단계 워크플로

### 1단계 — 예약 가능 날짜/시간 리포트 (주말 우선)

```bash
npm run dev -- query
```

오픈된 날짜를 모두 조회해 요일과 함께 출력하고, `preferWeekend: true` 면 주말을
앞세워 정렬한다. 가용 슬롯이 0개면 "예약이 어렵습니다"를 명확히 보고한다.

특정 날짜만 보려면 config 의 `preferences.dates` 에 `["2026-06-27"]` 처럼 넣는다.

### 2단계 — 정보 자동 입력 (config 기반)

```bash
npm run dev -- reserve                    # 주말 우선 첫 가용 슬롯
npm run dev -- reserve 2026-06-23 09:40   # 날짜/시간 지정
```

슬롯을 선택해 STEP 2 로 진입한 뒤 `reservation.config.json` 의 값으로 채운다:

- `reserver.person` — 인원(요금 재계산을 위해 change 이벤트 발생)
- `reserver.name` — 예약자명 (입금자명과 동일해야 예약 확정)
- `reserver.phone` — 연락처 (`010-1234-5678` → mobile1/2/3 자동 분할)
- `agreements.privacy`·`payment` — 필수 약관, 보통 `true`
- `agreements.marketing` — 선택 약관, 기본 `false`(체크 안 함)

입력을 마치면 **금액·예약 내용 요약**을 터미널에 출력한다(결제 직전 확인).

### 3단계 — 사람이 마무리

브라우저는 열린 채로 둔다. 사람이:

1. reCAPTCHA(자동등록방지)를 직접 푼다
2. 금액·내용 확인 후 `예약하기` 클릭
3. 안내된 계좌로 예약금 입금 (입금자명 = 예약자명)

스크립트는 STEP 2 를 벗어나면(제출 감지) 완료를 알리고, 최대 10분 대기한다.
자동으로 `예약하기`를 누르지 않는다.

## 설정 (config)

`reservation.config.json` (개인정보 포함 — `.gitignore` 됨). 없으면 템플릿 복사:

```bash
cp reservation.config.example.json reservation.config.json
```

| 키                          | 의미                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `themeUrl`                  | 예약 페이지 URL (zizum_num·theme_num·theme_info_num 으로 지점·테마 지정) |
| `themeName`                 | 출력용 테마 이름                                                         |
| `reserver.person`           | 인원 (2~6)                                                               |
| `reserver.name`             | 예약자명                                                                 |
| `reserver.phone`            | 연락처 (하이픈 포함/미포함 모두 허용)                                    |
| `agreements`                | 약관 동의 (privacy·payment 필수, marketing 선택)                         |
| `preferences.preferWeekend` | 주말 우선 정렬·선택 여부                                                 |
| `preferences.dates`         | 조회 대상 날짜 제한 (비우면 오픈된 전체)                                 |

## 두 실행 환경

- **cmux 환경**: cmux 브라우저로 즉석 조회·입력 (이 repo 없이도 가능). `cmux-browser` 스킬 참고.
- **순수 Playwright 환경**(cmux 없는 사용자): 이 repo 의 `npm run dev`. stealth Chrome 창을 띄운다.

`keyescape.ts` 가 핵심 로직(조회·정렬·선택·입력·요약)을 모듈로 제공하므로, 다른
스크립트에서 import 해 재사용할 수 있다.

## 재시도·예외 처리

- **슬롯이 그 사이 마감**: `selectSlot` 이 false 를 반환 → 다시 `query` 로 재조회 후 재시도.
- **이미 예약됨 / 만료 / 미입금**: KeyEscape 는 미입금 시 자동 취소된다. 같은 날짜/시간이
  다시 열렸는지 `query` 로 재조회하고, 열렸으면 같은 조건으로 `reserve` 재시도.
- **동일 예약자·동일 테마 6개월 2회 / 같은 날짜 1회** 제한이 있으니 반복 예약에 주의.

## 주의

- 인증된 사용에 한한다. 사이트 약관·robots.txt·관련 법을 준수한다.
- 헤드리스(`headless: true`)는 봇 탐지에 걸리기 쉽다 — 기본 헤드드(headed)를 유지한다.
- reCAPTCHA 는 자동으로 우회하지 않는다(사람이 푼다).

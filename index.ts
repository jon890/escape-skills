/**
 * KeyEscape 예약 자동화 — CLI (cmux 비의존 Playwright 실행 경로)
 *
 * cmux 브라우저가 없는 사용자를 위한 포터블 실행 경로.
 * stealth-template.mjs(rebrowser-playwright) 위에서 실제 Chrome 창을 띄운다.
 *
 * 사용법:
 *   npm run dev                      # = query. 예약 가능 날짜 리포트(주말 우선)
 *   npm run dev -- query             # 1단계: 예약 가능 날짜/시간 조회·리포트
 *   npm run dev -- reserve           # 2단계: 주말 우선 첫 슬롯에 정보 자동입력 후 정지
 *   npm run dev -- reserve 2026-06-23 09:40   # 특정 날짜/시간 지정 예약
 *
 * config: reservation.config.json (없으면 .example 안내). 예약자 정보·테마 URL·선호.
 *
 * 안전장치: reserve 모드는 STEP 2 정보 입력까지만 한다. reCAPTCHA 와 최종
 * "예약하기" 클릭은 사람이 직접 한다 — 결제 직전 금액·내용 확인 후 승인 원칙.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Browser } from "rebrowser-playwright";
import {
  type ReservationConfig,
  type ReservationSummary,
  availableSlots,
  fillReservationInfo,
  gotoStep2,
  openReservationPage,
  readSummary,
  reportAvailability,
  selectSlot,
} from "./keyescape.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 브라우저를 열어둔 채 프로세스를 SIGINT 까지 살려둔다.
 * Playwright 가 띄운 Chrome 은 node 프로세스가 끝나면 함께 닫히므로, 예약을
 * 이어서 진행할 수 있게 하려면 프로세스를 살려둬야 한다. Ctrl+C 로 정리 후 종료.
 */
async function holdOpen(browser: Browser, note: string): Promise<void> {
  console.log(note);
  await new Promise<void>((done) => {
    const close = async () => {
      console.log("\n브라우저를 닫고 종료합니다.");
      await browser.close().catch(() => {});
      done();
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}

function loadConfig(): ReservationConfig {
  const path = resolve(HERE, "reservation.config.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ReservationConfig;
  } catch {
    console.error(
      `[config] ${path} 를 읽을 수 없습니다.\n` +
        `         reservation.config.example.json 을 복사해 예약자 정보를 채우세요:\n` +
        `         cp reservation.config.example.json reservation.config.json`,
    );
    process.exit(1);
  }
}

function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

function printSummary(s: ReservationSummary): void {
  console.log("\n================ 예약 내용 최종 확인 (결제 직전) ================");
  console.log(`  상품      : ${s.goodName}`);
  console.log(`  날짜      : ${s.date}`);
  console.log(`  인원      : ${s.person}`);
  console.log(`  예약자    : ${s.name}`);
  console.log(`  연락처    : ${s.phone}`);
  console.log(`  요금      : ${won(s.price)}`);
  console.log(`  예약금    : ${won(s.deposit)}  (무통장입금 선결제)`);
  console.log(
    `  약관      : 개인정보(필수)=${s.agreePrivacy ? "O" : "X"} ` +
      `결제주의(필수)=${s.agreePayment ? "O" : "X"} ` +
      `마케팅(선택)=${s.agreeMarketing ? "O" : "X"}`,
  );
  console.log("=================================================================");
}

/** STAGE 1 — 예약 가능 날짜/시간 리포트 (주말 우선). */
async function runQuery(config: ReservationConfig): Promise<void> {
  const { browser, page } = await openReservationPage(config);
  let open: ReturnType<typeof availableSlots> = [];
  try {
    const reports = await reportAvailability(page, config);
    console.log(`\n[테마] ${config.themeName ?? config.themeUrl}\n`);
    for (const r of reports) {
      const weekendMark = r.isWeekend ? " ⭐주말" : "";
      if (r.status === "ok") {
        const times = r.slots.length ? r.slots.map((s) => s.time).join(", ") : "전 타임 마감";
        console.log(`  ${r.date}(${r.dow})${weekendMark}: ${times}`);
      } else {
        const label = {
          not_found: "달력에 없음",
          disabled: "예약 불가(마감/범위 밖)",
          no_timetable: "시간표 없음",
        }[r.status];
        console.log(`  ${r.date}(${r.dow})${weekendMark}: ${label}`);
      }
    }
    open = availableSlots(reports);
    console.log("");
    if (!open.length) {
      console.log("[결론] 예약 가능한 시간이 없습니다 — 현재 예약이 어렵습니다.");
    } else {
      console.log(`[결론] 총 ${open.length}개 슬롯 예약 가능 (주말 우선 정렬):`);
      for (const o of open) {
        console.log(`        - ${o.date}(${o.dow})${o.isWeekend ? " ⭐" : ""} ${o.slot.time}`);
      }
      console.log("\n  예약하려면:  npm run dev -- reserve <날짜> <시간>");
    }
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }

  // 예약 가능한 슬롯이 있으면 이어서 예약할 수 있도록 브라우저를 유지한다.
  // 가용 슬롯이 없으면 더 할 일이 없으니 바로 닫는다.
  if (open.length) {
    await holdOpen(
      browser,
      "\n[유지] 예약 가능한 슬롯이 있어 브라우저를 열어둡니다.\n" +
        "       이 창에서 직접 예약하거나, 다른 터미널에서 reserve 모드를 실행하세요.\n" +
        "       종료하려면 이 터미널에서 Ctrl+C.",
    );
  } else {
    await browser.close();
  }
}

/** STAGE 2+3 — 슬롯 선택 → 정보 자동입력 → reCAPTCHA 직전 정지(사람 인계). */
async function runReserve(config: ReservationConfig, date?: string, time?: string): Promise<void> {
  const { browser, page } = await openReservationPage(config);
  try {
    const reports = await reportAvailability(page, config);
    const open = availableSlots(reports);
    if (!open.length) {
      console.log("[예약] 예약 가능한 슬롯이 없습니다 — 예약이 어렵습니다.");
      await browser.close();
      return;
    }

    // 슬롯 결정: 인자 지정 우선, 없으면 주말 우선 첫 슬롯.
    const target = date
      ? open.find((o) => o.date === date && (!time || o.slot.time === time))
      : open[0];
    if (!target) {
      console.log(`[예약] 지정한 슬롯(${date} ${time ?? ""})을 찾을 수 없습니다. 가용 슬롯:`);
      for (const o of open) console.log(`        - ${o.date}(${o.dow}) ${o.slot.time}`);
      await browser.close();
      return;
    }

    console.log(`[예약] 선택 슬롯: ${target.date}(${target.dow}) ${target.slot.time}`);
    if (!(await selectSlot(page, target.date, target.slot.value))) {
      console.log("[예약] 슬롯 선택 실패 — 그 사이 마감됐을 수 있습니다. 다시 조회하세요.");
      await browser.close();
      return;
    }
    if (!(await gotoStep2(page))) {
      console.log("[예약] STEP 2 진입 실패.");
      await browser.close();
      return;
    }

    await fillReservationInfo(page, config);
    const summary = await readSummary(page);
    printSummary(summary);

    // 제출 감지(STEP 2 이탈)는 비차단으로 로깅만. 자동 클릭은 하지 않는다.
    page
      .waitForFunction(() => !/reservation2\.php/.test(location.href), undefined, {
        timeout: 15 * 60 * 1000,
      })
      .then(() => console.log("\n[완료] STEP 2 를 벗어났습니다 — 예약 제출이 진행된 것으로 보입니다."))
      .catch(() => {});

    // 브라우저를 유지해 사람이 reCAPTCHA·예약하기·입금을 마무리하게 한다.
    await holdOpen(
      browser,
      "\n[인계] 정보 입력을 마쳤습니다. 아래는 사람이 직접 진행합니다:\n" +
        "   1) 브라우저에서 reCAPTCHA(자동등록방지)를 직접 풀기\n" +
        "   2) 금액·내용 확인 후 [예약하기] 클릭\n" +
        `   3) 안내 계좌로 ${won(summary.deposit)} 입금 (입금자명: ${summary.name})\n` +
        "\n   브라우저는 열린 채로 둡니다. 완료 후 이 터미널에서 Ctrl+C 로 종료하세요.",
    );
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

async function main(): Promise<void> {
  const [mode = "query", arg1, arg2] = process.argv.slice(2);
  const config = loadConfig();

  if (mode === "reserve") {
    const date = arg1 && /^\d{4}-\d{2}-\d{2}$/.test(arg1) ? arg1 : undefined;
    const time = arg2 && /^\d{2}:\d{2}$/.test(arg2) ? arg2 : undefined;
    await runReserve(config, date, time);
  } else if (mode === "query") {
    await runQuery(config);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(mode)) {
    // 하위 호환: 날짜만 주면 그 날짜를 조회 대상으로
    await runQuery({ ...config, preferences: { ...config.preferences, dates: [mode] } });
  } else {
    console.error(`알 수 없는 모드: ${mode}. 사용법: query | reserve [date] [time]`);
    process.exit(1);
  }
}

await main();

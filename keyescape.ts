/**
 * KeyEscape 예약 자동화 — 핵심 모듈
 *
 * 예약 페이지(reservation1.php)의 DOM/AJAX 흐름을 그대로 따른다:
 *   STEP 1 달력에서 날짜 클릭 → AJAX 로 timepicker 로딩 → 시간 라디오 선택
 *   → NEXT → STEP 2(reservation2.php) 정보 입력 → reCAPTCHA → 예약하기
 *
 * 이 모듈은 STEP 2 정보 입력까지만 자동화한다. reCAPTCHA 와 최종 "예약하기"
 * 클릭은 의도적으로 사람에게 맡긴다 — 봇 방지벽이 사람을 요구하고, "결제 직전
 * 승인" 원칙을 코드 레벨에서 보장하기 위함이다.
 */
import type { Browser, Page } from "rebrowser-playwright";
import { createStealthBrowser, humanDelay } from "./stealth-template.mjs";

export interface ReservationConfig {
  themeUrl: string;
  themeName?: string;
  reserver: { person: number; name: string; phone: string };
  agreements: { privacy: boolean; payment: boolean; marketing: boolean };
  preferences: { preferWeekend: boolean; dates: string[]; times: string[] };
}

export interface Slot {
  time: string;
  value: string;
}

export type DateStatus = "ok" | "not_found" | "disabled" | "no_timetable";

export interface DateReport {
  date: string;
  dow: string;
  isWeekend: boolean;
  status: DateStatus;
  slots: Slot[];
}

const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/** 'YYYY-MM-DD' 의 요일 정보. 한국(KST) 기준 로컬 파싱이면 충분하다. */
export function dayInfo(date: string): {
  dow: number;
  label: string;
  isWeekend: boolean;
} {
  const d = new Date(`${date}T00:00:00`);
  const dow = d.getDay();
  return { dow, label: DOW_LABELS[dow], isWeekend: dow === 0 || dow === 6 };
}

/** 주말을 앞으로, 그다음 날짜 오름차순으로 정렬한다. */
export function sortWeekendFirst(dates: string[]): string[] {
  return [...dates].sort((a, b) => {
    const wa = dayInfo(a).isWeekend ? 0 : 1;
    const wb = dayInfo(b).isWeekend ? 0 : 1;
    return wa - wb || a.localeCompare(b);
  });
}

/** stealth Chrome 를 띄우고 예약 페이지로 이동한다. */
export async function openReservationPage(
  config: ReservationConfig,
  options: { headless?: boolean } = {},
): Promise<{ browser: Browser; page: Page }> {
  const { browser, page } = await createStealthBrowser({
    headless: options.headless ?? false,
  });
  // tsx/esbuild 의 --keep-names 가 page.evaluate 콜백 안의 이름 붙은 함수에
  // `__name(...)` 헬퍼 참조를 주입하는데, 브라우저 컨텍스트엔 그 헬퍼가 없어
  // ReferenceError 가 난다. 메인 월드에 폴리필을 깔아 모든 evaluate 를 보호한다.
  await page.addInitScript(() => {
    const g = globalThis as unknown as { __name?: (t: unknown) => unknown };
    g.__name ??= (t) => t;
  });
  await page.goto(config.themeUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("td.selDate", { timeout: 15000 });
  await humanDelay(500, 900);
  return { browser, page };
}

/** 달력 화면 보장 (timepicker 상태면 back 으로 복귀). */
async function ensureCalendar(page: Page): Promise<void> {
  await page.evaluate(() => {
    const back = document.querySelector<HTMLElement>("#datepicker #back_btn");
    if (back) back.click();
  });
  await humanDelay(500, 800);
}

/** 예약 오픈된(클릭 가능한) 날짜 목록을 달력에서 직접 읽는다. */
export async function getOpenDates(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("td.selDate.available"))
      .map((el) => el.getAttribute("data-date") || "")
      .filter(Boolean),
  );
}

/** 한 날짜의 빈 시간대를 조회한다 (날짜 클릭 → timepicker 로딩 → 활성 라디오 수집). */
export async function queryDate(page: Page, date: string): Promise<DateReport> {
  const info = dayInfo(date);
  const base = { date, dow: info.label, isWeekend: info.isWeekend };

  await ensureCalendar(page);
  const clicked = await page.evaluate((d) => {
    const el = document.querySelector<HTMLElement>(
      `td.selDate[data-date="${d}"]`,
    );
    if (!el) return "not_found";
    if (el.className.includes("disabled")) return "disabled";
    el.click();
    return "clicked";
  }, date);

  if (clicked === "not_found")
    return { ...base, status: "not_found", slots: [] };
  if (clicked === "disabled") return { ...base, status: "disabled", slots: [] };

  try {
    await page.waitForSelector("#datepicker .timeList li", { timeout: 8000 });
  } catch {
    return { ...base, status: "no_timetable", slots: [] };
  }
  await humanDelay(400, 700);

  const slots = await page.evaluate(() => {
    const out: { time: string; value: string }[] = [];
    document.querySelectorAll("#datepicker .timeList li").forEach((li) => {
      const radio = li.querySelector<HTMLInputElement>("input[type=radio]");
      const time = (li.querySelector("span")?.textContent || "").trim();
      if (radio && !radio.disabled) out.push({ time, value: radio.value });
    });
    return out;
  });
  return { ...base, status: "ok", slots };
}

/**
 * STAGE 1 — 예약 가능 날짜 리포트.
 * config.preferences.dates 가 있으면 그 날짜만, 없으면 오픈된 전체를 조회한다.
 * preferWeekend 면 주말을 앞세워 정렬한다.
 */
export async function reportAvailability(
  page: Page,
  config: ReservationConfig,
): Promise<DateReport[]> {
  const requested =
    config.preferences.dates?.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) ??
    [];
  const targets = requested.length ? requested : await getOpenDates(page);
  const ordered = config.preferences.preferWeekend
    ? sortWeekendFirst(targets)
    : targets;

  const reports: DateReport[] = [];
  for (const date of ordered) {
    reports.push(await queryDate(page, date));
  }
  return reports;
}

/** 리포트에서 예약 가능한 슬롯만 평탄화한다 (주말 우선 순서 유지). */
export function availableSlots(
  reports: DateReport[],
): Array<{ date: string; dow: string; isWeekend: boolean; slot: Slot }> {
  const out: Array<{
    date: string;
    dow: string;
    isWeekend: boolean;
    slot: Slot;
  }> = [];
  for (const r of reports) {
    if (r.status !== "ok") continue;
    for (const slot of r.slots)
      out.push({ date: r.date, dow: r.dow, isWeekend: r.isWeekend, slot });
  }
  return out;
}

/** 날짜+시간 라디오를 선택한다. value(themeTimeNum) 로 정확히 지정. */
export async function selectSlot(
  page: Page,
  date: string,
  value: string,
): Promise<boolean> {
  await queryDate(page, date); // timepicker 를 해당 날짜로 띄운다
  return page.evaluate((v) => {
    const radio = document.querySelector<HTMLInputElement>(
      `#datepicker input[type=radio][value="${v}"]`,
    );
    if (!radio || radio.disabled) return false;
    radio.click();
    return radio.checked;
  }, value);
}

/** NEXT 를 눌러 STEP 2 로 이동한다. */
export async function gotoStep2(page: Page): Promise<boolean> {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const next = btns.find((b) => (b.textContent || "").trim() === "NEXT");
    if (next) next.click();
  });
  try {
    await page.waitForURL(/reservation2\.php/, { timeout: 10000 });
    await page.waitForSelector("select[name=person]", { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * STAGE 2 — STEP 2 정보 입력.
 * 인원(person)·예약자명(name)·연락처(mobile1/2/3)·약관 동의를 config 에서 채운다.
 * 마케팅(선택) 동의는 config.agreements.marketing 이 true 일 때만 체크한다.
 * 인원 변경 시 요금/예약금이 재계산되므로 change 이벤트를 반드시 발생시킨다.
 */
export async function fillReservationInfo(
  page: Page,
  config: ReservationConfig,
): Promise<void> {
  const { reserver, agreements } = config;
  const [m1, m2, m3] = splitPhone(reserver.phone);

  // 인원 — 요금 재계산을 위해 change 이벤트 발생
  await page.evaluate((person) => {
    const sel = document.querySelector<HTMLSelectElement>(
      "select[name=person]",
    );
    if (sel) {
      sel.value = String(person);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, reserver.person);
  await humanDelay(300, 600);

  // 이름·연락처
  await page.evaluate(
    (vals) => {
      const set = (sel: string, val: string) => {
        const e = document.querySelector<HTMLInputElement>(sel);
        if (!e) return;
        e.focus();
        e.value = val;
        e.dispatchEvent(new Event("input", { bubbles: true }));
        e.dispatchEvent(new Event("change", { bubbles: true }));
        e.blur();
      };
      set("input[name=name]", vals.name);
      set("input[name=mobile1]", vals.m1);
      set("input[name=mobile2]", vals.m2);
      set("input[name=mobile3]", vals.m3);
    },
    { name: reserver.name, m1, m2, m3 },
  );
  await humanDelay(300, 600);

  // 약관 동의 — 필수(개인정보·결제주의)는 config 대로, 마케팅(선택)은 명시 true 일 때만
  await page.evaluate((ag) => {
    const check = (name: string, want: boolean) => {
      const c = document.querySelector<HTMLInputElement>(
        `input[name="${name}"]`,
      );
      if (c && c.checked !== want) c.click();
    };
    check("agree_1", ag.privacy);
    check("agree_2", ag.payment);
    check("agree_3", ag.marketing);
  }, agreements);
  await humanDelay(200, 400);
}

/** 채워진 STEP 2 의 최종 예약/금액 요약을 읽는다 (결제 직전 확인용). */
export interface ReservationSummary {
  goodName: string;
  date: string;
  person: string;
  name: string;
  phone: string;
  price: number;
  deposit: number;
  agreePrivacy: boolean;
  agreePayment: boolean;
  agreeMarketing: boolean;
  recaptchaSolved: boolean;
}

export async function readSummary(page: Page): Promise<ReservationSummary> {
  return page.evaluate(() => {
    const v = (n: string) =>
      document.querySelector<HTMLInputElement>(`[name="${n}"]`)?.value ?? "";
    const checked = (n: string) =>
      document.querySelector<HTMLInputElement>(`[name="${n}"]`)?.checked ??
      false;
    const sel = document.querySelector<HTMLSelectElement>(
      "select[name=person]",
    );
    return {
      goodName: v("good_name"),
      date: v("rev_days"),
      person: sel ? sel.options[sel.selectedIndex].text : v("person"),
      name: v("name"),
      phone: `${v("mobile1")}-${v("mobile2")}-${v("mobile3")}`,
      price: Number(v("rev_price")) || 0,
      deposit: Number(v("good_mny")) || 0,
      agreePrivacy: checked("agree_1"),
      agreePayment: checked("agree_2"),
      agreeMarketing: checked("agree_3"),
      recaptchaSolved: !!v("g-recaptcha-response"),
    };
  });
}

/** '010-1234-5678' → ['010','1234','5678']. 하이픈/공백 제거 후 3-4-4 분할. */
export function splitPhone(phone: string): [string, string, string] {
  const parts = phone.split("-").map((s) => s.trim());
  if (parts.length === 3) return [parts[0], parts[1], parts[2]];
  const digits = phone.replace(/\D/g, "");
  return [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7, 11)];
}

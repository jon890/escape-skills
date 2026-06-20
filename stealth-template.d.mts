import type { Browser, BrowserContext, Page } from "rebrowser-playwright";

export interface StealthBrowserOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string | null;
  locale?: string;
  storageState?: string | null;
  proxy?: { server: string; username?: string; password?: string } | null;
  noSandbox?: boolean;
}

export function createStealthBrowser(options?: StealthBrowserOptions): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}>;

export function saveSession(context: BrowserContext, path: string): Promise<void>;

export function humanDelay(min?: number, max?: number): Promise<void>;

export function humanType(page: Page, selector: string, text: string): Promise<void>;

export function simulateMouseMovement(page: Page, moves?: number): Promise<void>;

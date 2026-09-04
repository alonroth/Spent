import "server-only";

/** Shared hardened Chromium launch settings for every bank scraper. */
export function getChromiumLaunchOptions(): {
  args: string[];
  executablePath?: string;
} {
  const args = ["--disable-blink-features=AutomationControlled"];

  // Site Isolation protects authenticated bank pages from cross-site renderer
  // compromise. Keep it on unless a provider has a demonstrated OOPIF issue.
  if (process.env.SPENT_DISABLE_SITE_ISOLATION === "1") {
    console.warn(
      "[scraper] WARNING: Chromium Site Isolation is disabled by explicit configuration"
    );
    args.push("--disable-features=IsolateOrigins,site-per-process");
  }

  // Chromium's renderer sandbox is on by default. Root/container installs
  // that cannot provide the required kernel support must opt out explicitly.
  if (process.env.SPENT_DISABLE_CHROMIUM_SANDBOX === "1") {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  return {
    args,
    executablePath:
      process.env.SPENT_CHROME_EXECUTABLE_PATH?.trim() || undefined,
  };
}

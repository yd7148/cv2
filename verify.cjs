const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE || "http://localhost:4322";
const OUT = path.join(__dirname, "shots");

const targets = [
  { slug: "v2-zh-home", url: "/zh/", full: true },
  { slug: "v2-en-home", url: "/en/", full: true },
  { slug: "v2-zh-works", url: "/zh/works/", full: false },
  { slug: "v2-zh-work", url: "/zh/works/sic-wafer-yolo/", full: true },
  { slug: "v2-zh-resume", url: "/zh/resume/", full: true },
  { slug: "v2-zh-about", url: "/zh/about/", full: false },
  { slug: "v2-zh-notes", url: "/zh/notes/", full: false },
  { slug: "v2-zh-note", url: "/zh/notes/edge-vs-cloud/", full: false },
  { slug: "v2-zh-contact", url: "/zh/contact/", full: false },
];

(async () => {
  const fs = require("fs");
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = [];

  for (const t of targets) {
    for (const scheme of ["light", "dark"]) {
      if (t.full && scheme === "dark") continue;
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        colorScheme: scheme,
        locale: "zh-TW",
      });
      const page = await ctx.newPage();
      const errs = [];
      page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
      page.on("pageerror", (e) => errs.push(String(e)));
      const resp = await page.goto(BASE + t.url, { waitUntil: "networkidle" });
      await page.waitForTimeout(350);
      await page.screenshot({
        path: path.join(OUT, (scheme === "light" ? t.slug : t.slug + "-dark") + ".png"),
        fullPage: t.full,
        scale: "css",
      });
      report.push({
        page: t.url,
        scheme,
        status: resp.status(),
        hOverflow: await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        ),
        errors: errs.length,
        firstError: errs[0] || null,
      });
      await ctx.close();
    }
  }

  // mobile
  const mc = await browser.newContext({ viewport: { width: 375, height: 780 }, locale: "zh-TW" });
  const mp = await mc.newPage();
  await mp.goto(BASE + "/zh/", { waitUntil: "networkidle" });
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: path.join(OUT, "v2-zh-home-mobile.png"), fullPage: true, scale: "css" });
  report.push({
    page: "/zh/ 375px",
    hOverflow: await mp.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    ),
  });
  await mc.close();

  // sidebar sticky check + anchor nav + PII behaviour
  const sc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sp = await sc.newPage();
  await sp.goto(BASE + "/zh/", { waitUntil: "networkidle" });
  const sticky = await sp.evaluate(() => {
    const el = document.querySelector("aside");
    return el ? getComputedStyle(el).position : "no aside";
  });
  // 首頁刻意不含任何個資欄位
  const piiOnHome = await sp.evaluate(
    () => document.querySelectorAll("[data-pii]").length
  );
  const piiTextOnHome = await sp.evaluate(() => {
    const html = document.documentElement.outerHTML;
    return ["0933", "yd7148@gmail", "PUBLIC_EMAIL_WORK", "文桃"].filter((k) =>
      html.includes(k)
    );
  });
  // anchor navigation (use the desktop nav, not the hidden mobile menu)
  await sp.locator('a[href="#projects"]:visible').first().click();
  await sp.waitForTimeout(900);
  const scrolled = await sp.evaluate(() => window.scrollY);
  const projectsVisible = await sp.evaluate(() => {
    const el = document.getElementById("projects");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), inViewport: r.top < window.innerHeight && r.bottom > 0 };
  });
  await sp.close();

  // PII reveal behaviour lives on the A4 resume page
  const rc = await browser.newContext({ viewport: { width: 1000, height: 1300 } });
  const rp = await rc.newPage();
  await rp.goto(BASE + "/zh/resume/", { waitUntil: "networkidle" });
  const piiScreen = await rp.evaluate(() => {
    const el = document.querySelector("[data-pii]");
    return el ? getComputedStyle(el).color : "none";
  });
  await rp.locator("[data-pii]").first().click();
  const piiAfterClick = await rp.evaluate(() => {
    const el = document.querySelector("[data-pii]");
    return el ? getComputedStyle(el).color : "none";
  });
  await rp.emulateMedia({ media: "print" });
  const piiPrint = await rp.evaluate(() => {
    const els = Array.from(document.querySelectorAll("[data-pii]"));
    return { n: els.length, colors: Array.from(new Set(els.map((e) => getComputedStyle(e).color))) };
  });
  await rp.pdf({ path: path.join(OUT, "v2-resume-A4.pdf"), format: "A4", printBackground: true });
  await rc.close();

  await browser.close();
  console.log(
    JSON.stringify(
      {
        report,
        sidebarPosition: sticky,
        piiFieldsOnHome: piiOnHome,
        piiTextOnHome,
        piiScreenOnResume: piiScreen,
        piiAfterClickOnResume: piiAfterClick,
        anchorScrollY: scrolled,
        projectsVisible,
        piiPrint,
      },
      null,
      2
    )
  );
})();

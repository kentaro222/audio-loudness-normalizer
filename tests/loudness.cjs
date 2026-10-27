// Run against the local HTTP server. Requires playwright-core, Chromium and FFmpeg.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loudness-test-"));
  let browser;
  const media = name => path.join(dir, name);
  const ffmpeg = args => execFileSync("ffmpeg", ["-v", "error", ...args]);
  try {
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-af", "volume=0.5", "-metadata", "title=Test tone", media("quiet.wav")]);
    ffmpeg(["-i", media("quiet.wav"), "-af",
      "loudnorm=I=-14:TP=-1.5:LRA=11", media("target.wav")]);
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-af", "volume=7", media("loud.wav")]);
    ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-t", "1", media("silence.wav")]);
    fs.writeFileSync(media("invalid.wav"), "invalid audio");

    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"]
    });
    const page = await browser.newPage({ acceptDownloads: true });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:8000/");
    // Observe real FFmpeg commands to prove encoding does not rerun analysis.
    await page.evaluate(() => {
      const postMessage = Worker.prototype.postMessage;
      window.ffmpegCommands = [];
      Worker.prototype.postMessage = function(message, ...rest) {
        if(message.type === "EXEC") window.ffmpegCommands.push([...message.data.args]);
        return postMessage.call(this, message, ...rest);
      };
    });
    const analysisCount = () => page.evaluate(() =>
      window.ffmpegCommands.filter(args =>
        args.includes("loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json")).length);
    async function select(name) {
      await page.locator("#file").setInputFiles([]);
      await page.locator("#file").setInputFiles(media(name));
      await page.waitForFunction(() => !document.querySelector("#file").disabled,
        {}, { timeout: 60000 });
    }
    for (const [name, expected] of [
      ["quiet.wav", "adjust"], ["target.wav", "in-range"],
      ["loud.wav", "adjust"], ["silence.wav", "unknown"],
      ["invalid.wav", "unknown"]
    ]) {
      const before = await analysisCount();
      await select(name);
      assert.equal(await analysisCount(), before + 1);
      assert.equal(await page.locator("#loudnessResult").getAttribute("data-result"), expected);
      assert.equal(await page.locator("#convert").isEnabled(), true);
      console.log(name + ": " + await page.locator("#loudnessResult").textContent());
    }
    // Failed automatic analysis must not reuse an earlier valid measurement.
    const beforeRetry = await analysisCount();
    await page.locator("#convert").click();
    await page.waitForFunction(() => !document.querySelector("#convert").disabled,
      {}, { timeout: 60000 });
    assert.match(await page.locator("#status").textContent(), /エラー：/);
    assert.equal(await analysisCount(), beforeRetry + 1);
    // A new File with the same name must be reanalyzed, not matched by name.
    await select("target.wav");
    const count = await analysisCount();
    await select("target.wav");
    assert.equal(await analysisCount(), count + 1);
    const beforeEncoding = await analysisCount();
    assert.equal(await page.locator("#title").inputValue(), "Test tone");
    await page.locator("#title").fill("Edited title");
    for (const format of ["mp3", "ogg"]) {
      await page.locator("#format").selectOption(format);
      await page.locator("#convert").click();
      await page.waitForFunction(() => !document.querySelector("#convert").disabled,
        {}, { timeout: 120000 });
      assert.match(await page.locator("#status").textContent(), /完了：/);
      assert.equal(await analysisCount(), beforeEncoding);
      const downloadPromise = page.waitForEvent("download");
      await page.locator("#download").click();
      const download = await downloadPromise;
      await download.saveAs(media("output." + format));
      const info = JSON.parse(execFileSync("ffprobe", ["-v", "error",
        "-show_entries", "stream=codec_name:format=duration", "-of", "json",
        media("output." + format)], { encoding: "utf8" }));
      assert.equal(info.streams[0].codec_name, format === "mp3" ? "mp3" : "vorbis");
      assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.2);
      console.log(format + ": download and codec verified");
    }
    const targetFilter = await page.evaluate(() =>
      window.ffmpegCommands.findLast(args => args.some(arg =>
        arg.includes("measured_I="))).find(arg => arg.includes("measured_I=")));
    await select("quiet.wav");
    assert.equal(await analysisCount(), beforeEncoding + 1);
    await page.locator("#convert").click();
    await page.waitForFunction(() => !document.querySelector("#convert").disabled,
      {}, { timeout: 120000 });
    assert.match(await page.locator("#status").textContent(), /完了：/);
    assert.equal(await analysisCount(), beforeEncoding + 1);
    const quietFilter = await page.evaluate(() =>
      window.ffmpegCommands.findLast(args => args.some(arg =>
        arg.includes("measured_I="))).find(arg => arg.includes("measured_I=")));
    assert.notEqual(quietFilter, targetFilter);
    console.log("Cached analysis reused across formats and invalidated on file change");
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

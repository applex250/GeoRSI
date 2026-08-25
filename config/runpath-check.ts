/** Full /research run handler path against the real engine (the path that crashed). */
import { makePiMock } from "./pi-mock.js";
const notifications: string[] = [];
const entries: { lines: string[] }[] = [];
const { pi, cmds } = makePiMock({
	appendEntry: (_t: string, data: any) => entries.push({ lines: data.lines ?? [] }),
	captureNotifications: notifications,
});
(await import("../extensions/georsi.js")).default(pi);
const handler = cmds["research"].handler;
let widgetContent: string[] | undefined;
const ctx = {
	ui: {
		notify: (m: string) => notifications.push(m),
		setWidget: (_k: string, c: string[] | undefined) => (widgetContent = c),
	},
};
process.chdir("F:/ttt");
const t0 = Date.now();
await handler("run", ctx);
const stripAnsi = (s: string): string =>
	s
		.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
		.replace(/\x1b\][^\x1b]*(\x07|\x1b\\)/g, "");
const plain = entries.map((e) => stripAnsi(e.lines.join(" "))).join("\n");
const ok =
	!plain.includes("ENOENT") &&
	plain.includes("RESEARCH RESULT") &&
	plain.includes("⚙") &&
	widgetContent !== undefined;
console.log(`elapsed=${Math.round((Date.now() - t0) / 1000)}s ok=${ok}`);
console.log("notify:", notifications.slice(-2).join(" | ").slice(0, 160));
console.log(plain.includes("ENOENT") ? "RUNPATH_ENOENT_STILL" : ok ? "RUNPATH_OK" : "RUNPATH_CHECK");
process.exit(ok ? 0 : 1);

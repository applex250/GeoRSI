/**
 * Shared minimal pi-extension host mock for the config/*-check scripts.
 * One place to add methods when extensions/georsi.ts grows new registrations
 * (the registerTool gap that broke four checks at once taught us this).
 */
export function makePiMock(opts?: {
	appendEntry?: (type: string, data: { lines?: string[] }) => void;
	captureNotifications?: string[];
}) {
	const cmds: Record<string, any> = {};
	const pi: any = {
		registerCommand: (name: string, def: any) => {
			cmds[name] = def;
		},
		registerEntryRenderer: () => {},
		registerTool: () => {},
		appendEntry: opts?.appendEntry ?? ((_t: string, _data: any) => {}),
		on: () => {},
		ui: {
			notify: (m: string) => opts?.captureNotifications?.push(m),
			setWidget: () => {},
		},
	};
	return { pi, cmds };
}

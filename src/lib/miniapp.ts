import { sdk } from "@farcaster/miniapp-sdk";

export type MiniAppSession = {
  isMiniApp: boolean;
  context: Awaited<typeof sdk.context> | null;
};

let _session: MiniAppSession | null = null;
let _readyCalled = false;

export async function loadMiniAppSession(): Promise<MiniAppSession> {
  if (_session) return _session;

  const isMiniApp = await sdk.isInMiniApp();
  let context: Awaited<typeof sdk.context> | null = null;

  if (isMiniApp) {
    try {
      context = await sdk.context;
    } catch {
      context = null;
    }
  }

  _session = { isMiniApp, context };
  return _session;
}

export async function callReadyOnce() {
  if (_readyCalled) return;
  _readyCalled = true;
  try {
    // Hide the host splash screen as soon as our initial UI is stable.
    await sdk.actions.ready();
  } catch {
    // In a regular browser, this will throw. Ignore.
  }
}

export function hapticLight() {
  try {
    // Not all hosts support haptics. This will no-op/throw safely.
    // @ts-expect-error - haptics is optional depending on host
    sdk.haptics?.impactOccurred?.("light");
  } catch {
    // ignore
  }
}

export const APP_ORIGIN = "https://baseposting.online/";

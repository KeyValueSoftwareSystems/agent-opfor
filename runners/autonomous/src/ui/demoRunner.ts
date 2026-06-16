// Replays scripted demo timeline through the UI bridge — no API calls.

import { consola } from "consola";
import { buildDemoTimeline, DEMO_META, emptyDemoState } from "./demoData.js";
import { startUiServer } from "./server.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface UiDemoOptions {
  port?: number;
  openBrowser?: boolean;
}

export async function runUiDemo(options: UiDemoOptions = {}): Promise<void> {
  const port = options.port ?? 3847;
  const timeline = buildDemoTimeline();

  const handle = await startUiServer({
    port,
    openBrowser: options.openBrowser ?? true,
    meta: {
      objective: DEMO_META.objective,
      targetName: DEMO_META.targetName,
      targetEndpoint: DEMO_META.targetEndpoint,
      budgetUsd: DEMO_META.budgetUsd,
      commanderModel: DEMO_META.commanderModel,
      operatorModel: DEMO_META.operatorModel,
      scoutModel: DEMO_META.scoutModel,
    },
  });

  handle.bridge.setOverrideState(emptyDemoState());
  consola.info(`Demo UI at ${handle.url} — replaying scripted run (no API spend)`);

  let lastAt = 0;
  for (const step of timeline) {
    await sleep(step.delayMs - lastAt);
    lastAt = step.delayMs;
    if (step.line) handle.bridge.onLine(step.line);
    if (step.state) handle.bridge.setOverrideState(step.state);
    if (step.complete) handle.markComplete(step.complete);
  }

  consola.success("Demo replay complete — dashboard stays open until Ctrl+C");
  await new Promise<void>(() => {});
}

// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../apps/web/src/static-demo.js", () => ({ isStaticDemo: true }));

import { App } from "../../apps/web/src/App.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the public judge build on recorded evidence without API requests", async () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();

  render(<App />);
  await user.click(screen.getByRole("tab", { name: /Your rule/ }));

  expect(await screen.findAllByText("Recorded demo")).toHaveLength(2);
  expect(fetchMock).not.toHaveBeenCalled();

  await user.click(screen.getByRole("tab", { name: /Best repair/ }));
  expect(screen.getByText("Live rechecks are disabled in the public demo.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Run fresh recheck" })).toBeNull();
});

// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommerceWorkbench } from "../../apps/web/src/commerce/CommerceWorkbench.js";
import {
  commercePolicyText,
  recordedCommerceInvestigation,
} from "../../apps/web/src/commerce/recorded-investigation.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("commerce incentive workbench", () => {
  it("preserves every mapped rule when serializing a repair for recheck", () => {
    const policy = recordedCommerceInvestigation.candidates[0]!.policy;

    expect(commercePolicyText(policy)).toContain(
      `Purchases can be returned within ${policy.referral.returnWindowDays} days.`,
    );
    expect(commercePolicyText(policy)).toContain(
      policy.referral.promoCreditCountsTowardThreshold
        ? "Promotional credit counts toward the threshold."
        : "Promotional credit does not count toward the threshold.",
    );
  });

  it("opens on a plain-language failure and keeps technical depth optional", async () => {
    const user = userEvent.setup();
    render(<CommerceWorkbench />);

    expect(screen.getByRole("heading", { name: "Test whether rewards outlive value." })).toBeTruthy();
    expect(screen.getByText(/Fine Print asks Muse how a reward rule could fail/)).toBeTruthy();
    expect(screen.getByText("AI proposes transaction tests. The simulator decides what happened.")).toBeTruthy();
    expect(screen.queryByLabelText("Rewards rule")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.queryByRole("tab", { name: /Audience/ })).toBeNull();

    const counterexample = screen.getByRole("region", { name: "Investigation outcome" });
    expect(within(counterexample).getByText("Failure confirmed")).toBeTruthy();
    expect(within(counterexample).getByText("$20 was rewarded after the business kept $0.")).toBeTruthy();
    expect(within(counterexample).getByText("4 proposed → 3 needed")).toBeTruthy();
    expect(within(counterexample).getByText("A referred B.")).toBeTruthy();
    expect(within(counterexample).getByText("B bought P1 for $20.")).toBeTruthy();
    expect(within(counterexample).getByText("B refunded P1.")).toBeTruthy();
    await user.click(within(counterexample).getByText("Show verification details"));
    expect(within(counterexample).getByText("AI test idea")).toBeTruthy();
    expect(within(counterexample).getByText(/\$20 became spendable/)).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /Your rule/ }));
    expect(screen.getByLabelText("Rewards rule")).toBeTruthy();
    expect(screen.getByLabelText("Minimum value the business must keep")).toBeTruthy();
    expect(screen.getByLabelText("Honest customer promise to preserve")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "How Fine Print understood it" })).toBeTruthy();
    expect(screen.getByText(/\$10 each after a \$20 purchase/)).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: /Best repair/ }));
    const recommendation = screen.getByRole("region", { name: "Recommended repair" });
    expect(within(recommendation).getByRole("heading", { name: "Pay after return window" })).toBeTruthy();
    expect(within(recommendation).getByText("Reward value exposed")).toBeTruthy();
    expect(within(recommendation).getByText("Honest reward")).toBeTruthy();
    expect(within(recommendation).getByText("30 days")).toBeTruthy();
    const recordedRecheck = screen.getByRole("status", { name: "Fresh repair test" });
    expect(recordedRecheck.classList.contains("commerce__fresh-test--failure")).toBe(true);
    expect(within(recordedRecheck).getByText("Failure still present")).toBeTruthy();
    expect(within(recordedRecheck).getByText("Reverse credit on refund")).toBeTruthy();
    expect(within(recordedRecheck).getByText("$10 reward value exposed")).toBeTruthy();
    expect(within(recordedRecheck).getByText(/spent.*unrecovered reward value/i)).toBeTruthy();
    expect(within(recordedRecheck).getByText("Recorded AI recheck · simulator replayed")).toBeTruthy();
    expect(screen.getByText("Compare all repairs").closest("details")?.hasAttribute("open")).toBe(false);

    await user.click(screen.getByText("Compare all repairs"));
    expect(screen.getAllByRole("article")).toHaveLength(3);
    await user.click(screen.getByText("Show audience simulation"));
    const population = screen.getByRole("region", { name: "Participant population" });
    expect(within(population).getByText("Ordinary customers")).toBeTruthy();
    expect(within(population).getByText("Bargain hunters")).toBeTruthy();
    expect(within(population).getByText("Coordinated adversaries")).toBeTruthy();
    expect(within(population).getByText(/Simulation under stated assumptions/)).toBeTruthy();
  });

  it("ranks competing repairs by owner priority and fresh-tests the selection", async () => {
    const user = userEvent.setup();
    render(<CommerceWorkbench />);

    await user.click(screen.getByRole("tab", { name: /Best repair/ }));
    await user.click(screen.getByText("Compare all repairs"));
    await user.click(screen.getByRole("button", { name: "simple operations" }));
    const recommendation = screen.getByRole("region", { name: "Recommended repair" });
    expect(within(recommendation).getByText("Pay after return window")).toBeTruthy();

    const candidate = screen.getAllByRole("article").find((article) =>
      within(article).queryByRole("heading", { name: "Pay after return window" }),
    );
    expect(candidate).toBeTruthy();
    await user.click(within(candidate!).getByRole("button", { name: "Replay known failure" }));
    const retest = screen.getByRole("status", { name: "Fresh repair test" });
    expect(within(retest).getByText("This trace was blocked")).toBeTruthy();
    expect(within(retest).getByText("$0 reward value exposed")).toBeTruthy();
    expect(within(retest).getByText("$20 honest reward")).toBeTruthy();
    expect(within(retest).getByText("30 day wait")).toBeTruthy();
  });

  it("sends user policy and intended outcome separately and exposes unsupported conditions", async () => {
    let submitted: unknown;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/health") {
        return Response.json({ liveAgent: { isEnabled: true } });
      }
      if (url === "/api/usage") {
        return Response.json({ availableAppUsd: 8.5 });
      }
      if (url === "/api/commerce/investigations") {
        submitted = JSON.parse(String(init?.body));
        return Response.json(
          {
            id: "unsupported-1",
            replayed: false,
            modelId: "muse-spark-1.3",
            mapping: {
              status: "unsupported",
              reason: "Geography and device fingerprinting are outside this simulator.",
              policy: null,
              supportedClauses: ["$10 reward"],
              unsupportedConditions: ["country eligibility", "device fingerprinting"],
            },
            attack: null,
            candidates: [],
            population: null,
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, actualUsd: 0.001 },
          },
          { status: 201 },
        );
      }
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommerceWorkbench />);

    await user.click(screen.getByRole("tab", { name: /Your rule/ }));
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.queryByText(/\$8\.50 left/)).toBeNull();
    await user.clear(screen.getByLabelText("Rewards rule"));
    await user.type(
      screen.getByLabelText("Rewards rule"),
      "Pay $10 only to customers in Canada using a unique device.",
    );
    await user.clear(screen.getByLabelText("Minimum value the business must keep"));
    await user.type(screen.getByLabelText("Minimum value the business must keep"), "30");
    await user.clear(screen.getByLabelText("Honest customer promise to preserve"));
    await user.type(screen.getByLabelText("Honest customer promise to preserve"), "Keep the $10 reward");
    await user.click(screen.getByRole("button", { name: "Test my rule" }));

    expect(submitted).toEqual({
      sourceText: "Pay $10 only to customers in Canada using a unique device.",
      goal: {
        metric: "retained_revenue",
        minimumUsd: 30,
        description: "Acquire a referred customer who contributes at least $30 in retained revenue.",
      },
      restrictions: ["Keep the $10 reward"],
    });
    expect(await screen.findByText("Needs wider support")).toBeTruthy();
    expect(screen.getByText("country eligibility")).toBeTruthy();
    expect(screen.getByText("device fingerprinting")).toBeTruthy();
    expect(screen.queryByText("Failure confirmed")).toBeNull();
  });

  it("reports fresh-test customer outcomes from the attacked policy population", async () => {
    let freshRequest: unknown;
    const population = recordedCommerceInvestigation.population!;
    const liveResult = {
      ...recordedCommerceInvestigation,
      provenance: "live" as const,
      attack: {
        ...recordedCommerceInvestigation.attack!,
        discoveryMethod: "none" as const,
        modelProposalStatus: "candidate_invalid" as const,
        searchOutcome: "no_failure_found" as const,
        searchExpandedStates: 2_610,
        minimizedActions: [],
        events: [],
        verification: {
          status: "no_exploit" as const,
          availableRewardUsd: 0,
          unrecoveredRewardUsd: 0,
          retainedRevenueUsd: 0,
          unintendedPayoutUsd: 0,
          reason: "No failure found within this attempt.",
        },
      },
      population: {
        ...population,
        strategies: population.strategies.map((strategy) =>
          strategy.id === "ordinary"
            ? {
                ...strategy,
                metrics: { ...strategy.metrics, availableRewardUsd: 77, rewardDelayDays: 9 },
              }
            : strategy,
        ),
      },
      candidates: recordedCommerceInvestigation.candidates.map((candidate, index) =>
        index === 0
          ? {
              ...candidate,
              evaluation: {
                ...candidate.evaluation,
                honest: { ...candidate.evaluation.honest, availableRewardUsd: 999 },
              },
            }
          : candidate,
      ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        if (String(input) === "/api/health") {
          return Response.json({ liveAgent: { isEnabled: true } });
        }
        freshRequest = JSON.parse(String(init?.body));
        return Response.json(liveResult, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(<CommerceWorkbench />);

    await user.click(screen.getByRole("tab", { name: /Best repair/ }));
    await user.click(screen.getByText("Compare all repairs"));
    await user.click(screen.getAllByRole("button", { name: "Run fresh recheck" })[0]!);

    await screen.findByText("$77 honest reward");
    const retest = screen.getByRole("status", { name: "Fresh repair test" });
    expect(freshRequest).toMatchObject({ mode: "attack_only" });
    expect(within(retest).getByText("$77 honest reward")).toBeTruthy();
    expect(within(retest).getByText("9 day wait")).toBeTruthy();
    expect(within(retest).getByText("No failure found in this attempt")).toBeTruthy();
    expect(within(retest).getByText("Muse's proposal was rejected; systematic search completed across 2610 states.")).toBeTruthy();
    expect(within(retest).getByText("Systematic action search · simulator replayed")).toBeTruthy();
    expect(within(retest).queryByText("$999 honest reward")).toBeNull();
    await user.click(screen.getByRole("tab", { name: /Your rule/ }));
    expect(await screen.findByText("Ready")).toBeTruthy();
  });

  it("changes the recommended repair when a fresh confirmed case raises its observed exposure", async () => {
    let submitted: unknown;
    const previousRecommendation = recordedCommerceInvestigation.candidates.find(
      (candidate) => candidate.id === "c2",
    )!;
    const refreshedCandidates = recordedCommerceInvestigation.candidates.map((candidate) =>
      candidate.id === "c2"
        ? {
            ...candidate,
            evaluation: {
              ...candidate.evaluation,
              attack: {
                ...candidate.evaluation.attack,
                verifiedUnintendedPayoutUsd: 15,
              },
              knownAttackBlocked: false,
              evidence: {
                applicableCases: 3,
                blockedCases: 2,
                highestObservedExposureUsd: 15,
                worstCaseId: "fresh-confirmed",
              },
            },
          }
        : candidate,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        if (String(input) === "/api/health") {
          return Response.json({ liveAgent: { isEnabled: true } });
        }
        submitted = JSON.parse(String(init?.body));
        return Response.json(
          {
            ...recordedCommerceInvestigation,
            id: "fresh-confirmed",
            provenance: "live",
            testedCandidateId: previousRecommendation.id,
            policyHash: previousRecommendation.policyHash,
            evidenceSetId: recordedCommerceInvestigation.id,
            attack: {
              ...recordedCommerceInvestigation.attack,
              discoveryMethod: "deterministic_search",
              searchExpandedStates: 73,
              searchOutcome: "failure_found",
              verification: {
                ...recordedCommerceInvestigation.attack!.verification,
                unintendedPayoutUsd: 15,
              },
            },
            candidates: [],
            evidenceUpdate: {
              evidenceSetId: recordedCommerceInvestigation.id,
              sourcePolicyHash: recordedCommerceInvestigation.policyHash,
              totalConfirmedCases: 3,
              candidates: refreshedCandidates,
            },
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render(<CommerceWorkbench />);

    await user.click(screen.getByRole("tab", { name: /Best repair/ }));
    expect(
      within(screen.getByRole("region", { name: "Recommended repair" })).getByRole(
        "heading",
        { name: "Pay after return window" },
      ),
    ).toBeTruthy();
    const freshButton = within(
      screen.getByRole("region", { name: "Recommended repair" }),
    ).getByRole("button", { name: "Run fresh recheck" });
    await waitFor(() => expect((freshButton as HTMLButtonElement).disabled).toBe(false));
    await user.click(freshButton);

    expect(submitted).toMatchObject({
      mode: "attack_only",
      evidenceContext: {
        evidenceSetId: recordedCommerceInvestigation.id,
        testedCandidateId: "c2",
        expectedPolicyHash: previousRecommendation.policyHash,
      },
    });
    expect(
      await within(screen.getByRole("region", { name: "Recommended repair" })).findByRole(
        "heading",
        { name: "Reverse credit on refund" },
      ),
    ).toBeTruthy();
    expect(within(screen.getByRole("status", { name: "Fresh repair test" })).getByText("Failure still present")).toBeTruthy();
    expect(screen.getByText("Systematic action search · simulator replayed")).toBeTruthy();
    expect(screen.getByText("Observed under tested cases, not a guaranteed maximum.")).toBeTruthy();
  });

  it("does not present an unsupported fresh recheck as a blocked failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/health") return Response.json({ liveAgent: { isEnabled: true } });
        if (url === "/api/usage") return Response.json({ availableAppUsd: 8.5 });
        return Response.json(
          {
            id: "unsupported-fresh",
            replayed: false,
            modelId: "muse-spark-1.3",
            mapping: {
              status: "unsupported",
              reason: "The selected condition is outside this simulator.",
              policy: null,
              supportedClauses: [],
              unsupportedConditions: ["selected condition"],
            },
            attack: null,
            candidates: [],
            population: null,
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, actualUsd: 0.001 },
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render(<CommerceWorkbench />);

    await user.click(screen.getByRole("tab", { name: /Best repair/ }));
    await user.click(screen.getByText("Compare all repairs"));
    const freshButton = screen.getAllByRole("button", { name: "Run fresh recheck" })[0]!;
    await screen.findByText(/Lowest exposure observed across .* confirmed cases, then fastest reward/);
    await user.click(freshButton);

    expect(await screen.findByText("Fresh recheck could not run: The selected condition is outside this simulator.")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Fresh repair test" })).toBeNull();
    expect(screen.queryByText("This trace was blocked")).toBeNull();
  });

  it("presents a rejected sequence as rejection rather than verified evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url === "/api/health") return Response.json({ liveAgent: { isEnabled: true } });
        if (url === "/api/usage") return Response.json({ availableAppUsd: 8.5 });
        return Response.json(
          {
            ...recordedCommerceInvestigation,
            provenance: "live",
            attack: {
              ...recordedCommerceInvestigation.attack,
              proposedActionCount: 3,
              minimizedActions: [],
              events: [],
              verification: {
                status: "candidate_invalid",
                availableRewardUsd: 0,
                retainedRevenueUsd: 0,
                unintendedPayoutUsd: 0,
                reason: "The host rejected the proposed transaction sequence.",
              },
            },
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    render(<CommerceWorkbench />);

    await user.click(screen.getByRole("tab", { name: /Your rule/ }));
    await user.click(screen.getByRole("button", { name: "Test my rule" }));

    const outcome = await screen.findByRole("region", { name: "Investigation outcome" });
    expect(within(outcome).getByText("Test could not be replayed")).toBeTruthy();
    expect(within(outcome).getByText("The simulator rejected this transaction sequence.")).toBeTruthy();
    expect(within(outcome).queryByText("Host verified")).toBeNull();
  });
});

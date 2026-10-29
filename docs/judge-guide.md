# Judge guide

Fine Print is designed to make its core claim reviewable without spending credits or waiting for a model response.

## 60-second path

1. Open the live demo. It starts on **Commerce · What went wrong**.
2. Read the three headline metrics: `$20` reward, `$0` retained value, `3` required transactions.
3. Follow the three replay events: referral → purchase → refund.
4. Open **Best repair**. The recorded recheck shows why immediate reversal still leaves `$10` unrecovered; the recommended pay-after-window design exposes `$0`, preserves `$20` of honest reward, and discloses a 30-day wait.
5. Switch to **Bottle Return lab** to see the same method transfer to a 3D processing-reward system.

## Trust boundary

```text
Muse proposes a hypothesis and actions
                 ↓
strict schemas and host-enforced limits
                 ↓
deterministic simulator replays from root state
                 ↓
host verdict, durable evidence, regression case
```

Muse cannot set a result, edit a rule, access credentials, or execute code. Recorded evidence in the public build comes from live Muse runs whose complete artifacts, usage, and run IDs are checked into `artifacts/`.

## Reproduce locally

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

The static public build intentionally disables paid controls. Configure a local `.env` and start the API only when reproducing live Meta requests.

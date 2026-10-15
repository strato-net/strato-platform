# Bridge rollout

The canonical end-to-end EAB and native deployment procedure is
[`EAB_DEPLOYMENT.md`](EAB_DEPLOYMENT.md).

Use that runbook for:

- fresh combined EAB + native deployments;
- EAB-only deployments;
- adding native to an existing EAB deployment;
- contract deployment and upgrade order;
- Infra Runtime/verifier handoff;
- readable admin approval files;
- activation, canaries and partial-failure recovery.

The supported workflow is:

```bash
npm run external:rollout -- init --manifest <deployment.json> ...
npm run external:rollout -- prepare --manifest <deployment.json>
npm run external:rollout -- continue --manifest <deployment.json>
npm run external:rollout -- approve --file <admin-approval-ID.json>
npm run external:rollout -- verify --manifest <deployment.json>
```

Older persona setup, bundle, status, resume, vote and
`activate --approve` instructions are obsolete and must not be used for a new or
resumed rollout.

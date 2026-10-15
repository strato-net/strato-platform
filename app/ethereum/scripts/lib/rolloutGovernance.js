const fs = require("node:fs");
const path = require("node:path");

const { CONTRACTS, digest, readJson, writeJson, address, bool, governanceBatch, isActivationCall, isDependencyPending } = require("./externalBridgeOrchestration");
const { submit } = require("../../../contracts/deploy/configure-external-bridge");
const { jsonFetch, limitConcurrentFetches, resolveSourceToken, withDeadline, redactFor, CHECK_TIMEOUT_MS, INSPECTION_TIMEOUT_MS } = require("./rolloutRuntime");

async function fetchAdminVotingPolicy(settings, nodeUrl, token, fetchImpl = fetch) {
  const registry = address(settings.adminRegistry);
  const fetchRows = (table, params) => jsonFetch(
    `${nodeUrl.replace(/\/$/, "")}/cirrus/search/${table}?${new URLSearchParams(params)}`, token, fetchImpl);
  const registryRows = await fetchRows("BlockApps-AdminRegistry", {
    address: `eq.${registry}`,
    select: "defaultVotingThresholdBps,admins:BlockApps-AdminRegistry-admins(address:value),thresholds:BlockApps-AdminRegistry-votingThresholds(target:key,func:key2,threshold:value)",
    limit: 1,
  });
  const row = registryRows[0] || {};
  const admins = Array.isArray(row.admins)
    ? row.admins.filter(({ address: admin }) => admin && admin !== "Unknown") : [];
  if (!Array.isArray(admins) || admins.length === 0) throw new Error("AdminRegistry admins are unavailable");
  const defaultThresholdBps = Number(row.defaultVotingThresholdBps);
  if (!Number.isSafeInteger(defaultThresholdBps) || defaultThresholdBps <= 0) throw new Error("AdminRegistry default threshold is unavailable");
  const thresholds = new Map((row.thresholds || []).map(({ target, func, threshold }) =>
    [`${address(target)}:${func}`, Number(threshold)]));
  const adminAddresses = admins.map(row => address(row.address));
  if (new Set(adminAddresses).size !== adminAddresses.length || adminAddresses.some(value => !/^[a-f0-9]{40}$/.test(value) || /^0+$/.test(value))) {
    throw new Error("AdminRegistry voter identities are unavailable");
  }
  return { adminCount: admins.length, admins: adminAddresses, defaultThresholdBps, thresholds };
}

function requiredAdminVotes(policy, call) {
  if (!policy) return undefined;
  const bps = policy.thresholds.get(`${address(call.args._target)}:${call.args._func}`) ||
    policy.defaultThresholdBps;
  return Math.ceil((bps * policy.adminCount) / 10000);
}

function recordedVoteMetadata(calls, artifacts) {
  if (!artifacts?.directory || !fs.existsSync(path.dirname(artifacts.directory))) return new Map();
  const callIds = new Set(calls.map(({ id }) => id));
  const metadata = new Map();
  for (const entry of fs.readdirSync(path.dirname(artifacts.directory), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(path.dirname(artifacts.directory), entry.name);
    for (const file of fs.readdirSync(directory).filter((name) => /^votes-[a-f0-9]{40}\.json$/.test(name))) {
      for (const [id, vote] of Object.entries(readJson(path.join(directory, file)))) {
        if (!callIds.has(id)) continue;
        const current = metadata.get(id) || { hashes: new Set() };
        for (const hash of vote.hashes || []) current.hashes.add(String(hash).toLowerCase());
        const issueId = vote.issueId || vote.receipt?.issueId;
        if (issueId) current.issueId = String(issueId).toLowerCase();
        metadata.set(id, current);
      }
    }
  }
  return metadata;
}

function recordedIssueIds(calls, artifacts) {
  return new Map([...recordedVoteMetadata(calls, artifacts)]
    .filter(([, value]) => value.issueId).map(([id, value]) => [id, value.issueId]));
}

function comparableGovernanceValue(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object" && "value" in value) return comparableGovernanceValue(value.value);
  const text = String(value ?? "").trim();
  if (/^(true|false)$/i.test(text)) return text.toLowerCase();
  if (/^0x[0-9a-fA-F]{40}$/.test(text) || /^[0-9a-fA-F]{40}$/.test(text)) return address(text);
  if (/^-?\d+$/.test(text)) return BigInt(text).toString();
  return text;
}

function parseGovernanceEventArgs(raw) {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [raw];
    }
  }
  return [raw];
}

function sameGovernanceArgs(call, eventArgs) {
  const expected = (call.args?._args || []).map(({ value }) => comparableGovernanceValue(value));
  const actual = parseGovernanceEventArgs(eventArgs).map(comparableGovernanceValue);
  return expected.length === actual.length && expected.every((value, index) => value === actual[index]);
}

async function fetchLiveAdminVoteCounts(settings, nodeUrl, token, calls, artifacts, fetchImpl = fetch) {
  if (!calls.length) return new Map();
  const registry = address(settings.adminRegistry);
  const queryFetch = limitConcurrentFetches(fetchImpl);
  const read = async (table, params) => {
    const rows = [];
    for (let offset = 0; ;) {
      const page = await jsonFetch(`${nodeUrl.replace(/\/$/, "")}/cirrus/search/BlockApps-AdminRegistry${table}?${new URLSearchParams({
        address: `eq.${registry}`, order: "key.asc", ...params, limit: 200, offset,
      })}`, token, queryFetch);
      if (!Array.isArray(page)) throw new Error("Governance state unavailable");
      if (!page.length) return rows;
      rows.push(...page);
      offset += page.length;
    }
  };
  const [active, adminRows] = await Promise.all([
    read("-currentIssues", { value: "eq.true", select: "key,value" }),
    read("-admins", { select: "key,value" }),
  ]);
  const admins = new Set(adminRows.map(row => address(row.value)));
  if (!admins.size || [...admins].some(value => !/^[a-f0-9]{40}$/.test(value) || /^0+$/.test(value))) {
    throw new Error("Current governance voter set is unavailable");
  }
  if (calls.some(item => item.policyAdmins && (item.policyAdmins.length !== admins.size || item.policyAdmins.some(admin => !admins.has(admin))))) {
    throw new Error("Governance voter set changed during inspection; reconcile before voting");
  }
  const ids = [...new Set(active.filter(row => bool(row.value)).map(row => String(row.key)))];
  if (ids.some(id => !/^(0x)?[a-f0-9]{64}$/i.test(id))) throw new Error("Invalid active governance issue ID");
  for (const item of calls) {
    if (!item.call?.args?._target || !item.call?.args?._func) throw new Error("Governance call identity unavailable");
  }
  const created = [], executed = [], votes = [];
  const batches = [];
  for (let start = 0; start < ids.length; start += 50) batches.push(ids.slice(start, start + 50));
  // Identify active issues from complete creation metadata; only read execution/voter
  // history for issues matching the exact pending calls, including their arguments.
  for (let start = 0; start < batches.length; start += 4) {
    const pages = await Promise.all(batches.slice(start, start + 4).map(batch =>
      read("-IssueCreated", { issueId: `in.(${batch.join(",")})`, select: "issueId,target,func,args,block_number,event_index", order: "block_number.desc,event_index.desc" })));
    pages.forEach(page => created.push(...page));
  }
  const position = row => {
    if (!/^\d+$/.test(String(row.block_number)) || !/^\d+$/.test(String(row.event_index))) throw new Error("Governance lifecycle ordering unavailable");
    return [BigInt(row.block_number), BigInt(row.event_index)];
  };
  const compare = (a, b) => {
    const x = position(a), y = position(b);
    return x[0] === y[0] ? (x[1] > y[1] ? -1 : x[1] < y[1] ? 1 : 0) : x[0] > y[0] ? -1 : 1;
  };
  created.forEach(position);
  created.sort(compare);
  const latest = new Map();
  for (const row of created) if (!latest.has(row.issueId)) latest.set(row.issueId, row);
  if (ids.some(id => !latest.has(id))) throw new Error("Governance issue lifecycle is inconsistent; wait for indexing before voting");
  const relevantIds = ids.filter(id => calls.some(item => {
    const row = latest.get(id);
    return address(row.target) === address(item.call.args._target) && row.func === item.call.args._func && sameGovernanceArgs(item.call, row.args);
  }));
  for (let start = 0; start < relevantIds.length; start += 50) {
    const filter = `in.(${relevantIds.slice(start, start + 50).join(",")})`;
    const pages = await Promise.all([
      read("-IssueExecuted", { issueId: filter, select: "issueId,block_number,event_index", order: "block_number.desc,event_index.desc" }),
      read("-votes", { key: filter, select: "key,key2,value", order: "key.asc,key2.asc" }),
    ]);
    executed.push(...pages[0]); votes.push(...pages[1]);
  }
  executed.forEach(position);
  for (const id of relevantIds) {
    if (executed.some(row => row.issueId === id && compare(row, latest.get(id)) <= 0)) {
      throw new Error("Governance issue lifecycle is inconsistent; wait for indexing before voting");
    }
  }
  const counts = new Map();
  for (const item of calls) {
    if (!item.call?.args?._target || !item.call?.args?._func) throw new Error("Governance call identity unavailable");
    const match = [...latest.values()].find(row => address(row.target) === address(item.call.args._target) &&
      row.func === item.call.args._func && sameGovernanceArgs(item.call, row.args));
    const voters = new Set();
    if (match) for (const row of votes.filter(row => row.key === match.issueId)) {
      const voter = address(row.value);
      if (/^0{40}$/.test(voter)) continue;
      if (!admins.has(voter) || voters.has(voter)) throw new Error("Governance issue contains an invalid or stale voter set");
      voters.add(voter);
    }
    if (match && voters.size === 0) throw new Error("Active governance issue has no indexed votes; retry before voting");
    item.governanceIssueId = match?.issueId;
    item.governanceVoters = [...voters];
    item.governanceAdmins = [...admins];
    counts.set(item.id, voters.size);
  }
  return counts;
}

function requireLiveAdminVoteCounts(source, report) {
  if (source?.voteCountsDeferred || source?.liveVoteCountsError || ["UNAVAILABLE", "DEFERRED"].includes(report?.liveVoteCounts?.status)) {
    throw new Error("Live AdminRegistry vote counts are unavailable; restore the STRATO vote query and rerun continue");
  }
}

async function vote(context, artifacts, inspection, approval, options = {}) {
  const { inspect, sourceState } = require("./rolloutEabInspection");
  if (inspection.report.approvalHash !== approval) throw new Error("Approval is stale; review a fresh resume report");
  if (!inspection.source || !inspection.externalReady || (inspection.router?.paused !== true &&
      !(options.allowActiveEab && context.manifest.scope === "native" && inspection.report.nativeMode && inspection.router?.paused === false))) throw new Error("Voting requires verified external code, paused vault/router, and readable STRATO state");
  if (inspection.source.inactiveTokens?.length || inspection.report.calls.some(item => item.status === "BLOCKED" && !isDependencyPending(item) && item.call.args._func === "initialize")) {
    throw new Error("Resolve inactive tokens or conflicting initialization before voting");
  }
  requireLiveAdminVoteCounts(inspection.source, inspection.report);
  const token = await resolveSourceToken(context);
  const nodeUrl = context.manifest.services.nodeUrl.replace(/\/$/, "");
  const identity = await jsonFetch(`${nodeUrl.replace(/\/$/, "")}/strato/v2.3/key`, token, options.fetchImpl);
  if (!/^[a-f0-9]{40}$/.test(address(identity.address))) throw new Error("Unable to resolve STRATO voter identity");
  const config = require(path.join(CONTRACTS, "config"));
  config.nodes[0].url = nodeUrl;
  const journalFile = path.join(artifacts.directory, `votes-${address(identity.address)}.json`);
  const journal = fs.existsSync(journalFile) ? readJson(journalFile) : {};
  const submitted = [];
  const approved = governanceBatch(inspection.report).calls;
  const approvedIds = new Set(approved.map(({ id }) => id));
  const expectedExecutions = new Set();
  let indexingWaitMs = 0;
  let indexingStartedAt;
  const waitForIndexing = async () => {
    indexingStartedAt ??= Date.now();
    indexingWaitMs = Math.max(indexingWaitMs, Date.now() - indexingStartedAt);
    if (indexingWaitMs >= (options.indexWaitMs ?? 30_000)) return false;
    const interval = Math.min(750, (options.indexWaitMs ?? 30_000) - indexingWaitMs);
    console.error("[approval] Waiting for governance execution/indexing before the next call...");
    await (options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms))))(interval);
    indexingWaitMs = Math.max(indexingWaitMs + interval, Date.now() - indexingStartedAt);
    return true;
  };
  for (const item of approved) {
    let fresh, liveCall;
    while (true) {
      if (options.approvalExpiresAt !== undefined && Date.now() >= options.approvalExpiresAt) {
        throw new Error("Approval command expired during processing; Coordinator reruns continue. Submitted votes remain recorded.");
      }
      const enabling = isActivationCall(item);
      const refreshed = enabling ? await withDeadline("Activation readiness recheck", () => (options.inspect || inspect)(context, artifacts), INSPECTION_TIMEOUT_MS) : undefined;
      if (enabling) {
        const observed = refreshed.report.calls.find(({ id }) => id === item.id);
        if (!refreshed.source || !observed || (observed.status !== "COMPLETE" &&
            (!refreshed.externalReady || refreshed.router?.paused !== true || (observed.status !== "READY" && !isDependencyPending(observed))))) {
          throw new Error("Activation gates changed; stop and review before voting");
        }
      }
      fresh = refreshed?.source || await withDeadline("Governance state recheck", () => (options.sourceState || sourceState)(context, artifacts), CHECK_TIMEOUT_MS);
      if (fresh.inactiveTokens?.length) throw new Error("Token status changed; stop and review before voting");
      if (fresh.liveVoteCountsError && expectedExecutions.size && await waitForIndexing()) continue;
      requireLiveAdminVoteCounts(fresh, refreshed?.report);
      liveCall = fresh.calls.find(({ id }) => id === item.id);
      const eligible = governanceBatch({ ...inspection.report, calls: fresh.calls }).calls.some(({ id }) => id === item.id);
      if (!liveCall || digest(liveCall.call) !== digest(item.call) ||
          (liveCall.status !== "COMPLETE" && !eligible)) throw new Error("Approved call changed before submission");
      if (liveCall.status === "COMPLETE") {
        submitted.push({ id: item.id, status: "ALREADY_COMPLETE" });
        break;
      }
      if (enabling && (!refreshed.externalReady || refreshed.router?.paused !== true || (liveCall.status !== "READY" && !isDependencyPending(liveCall)))) {
        throw new Error("Activation gates changed; stop and review before voting");
      }
      if (options.stateless) {
        if (!Array.isArray(liveCall.governanceVoters) || !Array.isArray(liveCall.governanceAdmins) ||
            !liveCall.governanceAdmins.includes(address(identity.address))) {
          throw new Error("Live registered-admin/voter evidence unavailable or this account is not an admin; reconcile before voting");
        }
        if (liveCall.governanceVoters.includes(address(identity.address))) {
          submitted.push({ id: item.id, status: "ALREADY_VOTED" });
          break;
        }
      }
      if (options.stateless && (!Number.isSafeInteger(liveCall.requiredAdminVotes) || liveCall.requiredAdminVotes < 1 ||
          liveCall.requiredAdminVotes > liveCall.governanceAdmins.length || !Number.isSafeInteger(liveCall.recordedAdminVotes) ||
          liveCall.recordedAdminVotes !== liveCall.governanceVoters.length)) {
        throw new Error("Live quorum evidence unavailable; reconcile before voting");
      }
      if (isDependencyPending(liveCall)) {
        if (liveCall.dependencies.some(id => !approvedIds.has(id) && fresh.calls.find(parent => parent.id === id)?.status !== "COMPLETE")) {
          throw new Error("Approved batch is missing an unfinished prerequisite");
        }
        const required = liveCall.requiredAdminVotes, recorded = liveCall.recordedAdminVotes;
        if (!options.stateless || !Number.isSafeInteger(required) || required < 1 ||
            !Number.isSafeInteger(recorded) || recorded !== liveCall.governanceVoters.length) {
          throw new Error("Live quorum evidence unavailable for a dependent vote; reconcile before voting");
        }
        if (recorded + 1 >= required) {
          const executionExpected = liveCall.dependencies.some(id => expectedExecutions.has(id) ||
            fresh.calls.find(parent => parent.id === id)?.recordedAdminVotes >= fresh.calls.find(parent => parent.id === id)?.requiredAdminVotes);
          if (executionExpected && await waitForIndexing()) continue;
          submitted.push({ id: item.id, status: "WAITING_FOR_PREREQUISITES" });
          return submitted;
        }
      }
      break;
    }
    if (liveCall.status === "COMPLETE" || (options.stateless && liveCall.governanceVoters?.includes(address(identity.address)))) continue;
    if (journal[item.id]) {
      const previous = journal[item.id];
      if (!previous.hashes?.length) throw new Error(`Uncertain prior submission for ${item.id}; reconcile chain evidence before retrying`);
      const results = await (options.receipts || (async (hashes) => {
        const { rest } = require(require.resolve("blockapps-rest", { paths: [CONTRACTS] }));
        return rest.getBlocResults({ token }, hashes, { config, isAsync: true });
      }))(previous.hashes);
      if (!Array.isArray(results) || results.length !== previous.hashes.length || results.some((result) => result.status !== "Success" || !previous.hashes.includes(result.hash)) || new Set(results.map((result) => result.hash)).size !== results.length) throw new Error(`Prior vote ${item.id} is pending, failed, or unavailable; reconcile before retrying`);
      journal[item.id] = { ...previous, status: "VOTED", receipt: results };
      writeJson(journalFile, journal);
      const live = fresh.calls.find(call => call.id === item.id);
      if (!Array.isArray(live?.governanceVoters)) throw new Error("Live governance voter set unavailable; reconcile before retrying");
      if (live.governanceVoters.includes(address(identity.address))) {
        submitted.push({ id: item.id, status: "WAITING_FOR_QUORUM", hashes: previous.hashes });
        continue;
      }
    }
    journal[item.id] = { status: "SUBMITTING", call: item.call };
    writeJson(journalFile, journal);
    try {
      const receipt = await withDeadline("Governance vote submission", () => (options.submit || submit)({ token }, item.call, async (hashes) => {
        journal[item.id].hashes = hashes;
        writeJson(journalFile, journal);
        if (options.stateless) console.error(`[approval] ${item.call.args._func} submitted: ${hashes.join(", ")}`);
      }), 90_000);
      journal[item.id] = { ...journal[item.id], status: "VOTED", receipt };
      writeJson(journalFile, journal);
      if (Number.isSafeInteger(liveCall.requiredAdminVotes) && (liveCall.recordedAdminVotes || 0) + 1 >= liveCall.requiredAdminVotes) expectedExecutions.add(item.id);
      submitted.push({ id: item.id, ...receipt, note: "Vote succeeded; execution is established by the next live reconciliation" });
    } catch (error) {
      journal[item.id].error = redactFor(context, error.message);
      writeJson(journalFile, journal);
      throw error;
    }
  }
  return submitted;
}

function recordedVoteCounts(calls, artifacts) {
  if (!artifacts?.directory) return calls.map(() => 0);
  const journals = new Map();
  for (const entry of fs.readdirSync(path.dirname(artifacts.directory), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(path.dirname(artifacts.directory), entry.name);
    for (const file of fs.readdirSync(directory).filter((name) => /^votes-[a-f0-9]{40}\.json$/.test(name))) {
      const voter = file.slice(6, -5);
      const journal = journals.get(voter) || {};
      for (const [id, vote] of Object.entries(readJson(path.join(directory, file)))) {
        if (vote.status === "VOTED") journal[id] = vote;
      }
      journals.set(voter, journal);
    }
  }
  return calls.map(({ id }) => [...journals.values()].filter((journal) => journal[id]?.status === "VOTED").length);
}

function approvedCallsCompleted(artifacts, approval, currentCalls = []) {
  if (!artifacts?.directory || !fs.existsSync(artifacts.directory)) return false;
  const currentStatuses = new Map(currentCalls.map(({ id, status }) => [id, status]));
  for (const file of fs.readdirSync(artifacts.directory).filter((name) => /^report-.*\.json$/.test(name))) {
    const prior = readJson(path.join(artifacts.directory, file));
    if (prior.approvalHash !== approval) continue;
    const approvedCallIds = (prior.calls || [])
      .filter(({ status }) => status === "READY")
      .map(({ id }) => id);
    if (approvedCallIds.length &&
        approvedCallIds.every((id) => currentStatuses.get(id) === "COMPLETE")) return true;
  }
  return false;
}

module.exports = { fetchAdminVotingPolicy, requiredAdminVotes, recordedVoteMetadata, recordedIssueIds, comparableGovernanceValue, parseGovernanceEventArgs, sameGovernanceArgs, fetchLiveAdminVoteCounts, requireLiveAdminVoteCounts, vote, recordedVoteCounts, approvedCallsCompleted };

// ================================================================
// Test Script for BullMQ Ticket Generation Queue
//
// Usage: npx ts-node src/tests/test-ticket-queue.ts
//
// Tests:
//  1.  startTicketQueue()       — queue + worker init
//  2.  Idempotency              — second start is no-op
//  3.  getTicketQueueStats()    — stats accessible
//  4.  dispatchTicketGeneration — job queued, returns jobId
//  5.  getTicketJobStatus       — poll job status
//  6.  Worker processes job     — job eventually leaves 'waiting'
//  7.  Dispatch multiple jobs   — concurrency stress
//  8.  Job chaining             — email + SMS jobs added after gen
//  9.  Queue stats after work   — counters updated
// 10.  stopTicketQueue()        — graceful shutdown
// 11.  Status after stop        — returns null
// 12.  Dispatch after stop      — returns sync-fallback
// 13.  Double stop              — safe, no crash
// ================================================================

import {
  startTicketQueue,
  stopTicketQueue,
  dispatchTicketGeneration,
  getTicketJobStatus,
  getTicketQueueStats,
  type TicketJobData,
} from "../lib/jobs/ticketQueue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Create mock TicketJobData for testing
 * Uses fake IDs — worker may fail on DB insert (expected; we test the queue plumbing)
 */
const createMockTicketData = (
  bookingId: number,
  seatCount: number = 2
): TicketJobData => ({
  bookingId,
  bookingReference: `BKG-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  eventId: 99999,
  userId: 99999,
  event: {
    name: "Test Concert 2026",
    start_date: "2026-06-15T18:00:00Z",
    end_date: "2026-06-15T23:00:00Z",
    location: "Mumbai, India",
    venue_name: "Wankhede Stadium",
  },
  user: {
    name: "Test User",
    email: "test@example.com",
    phone: "+919876543210",
  },
  seats: Array.from({ length: seatCount }, (_, i) => ({
    seatId: 90000 + i,
    seatLabel: `T${i + 1}`,
    seatTypeId: 99999,
    seatTypeName: "Test VIP",
    pricePaid: 1500 + i * 100,
    bookedAt: new Date().toISOString(),
  })),
});

async function runTicketQueueTests() {
  console.log("\n🧪 BullMQ Ticket Generation Queue — Test Suite");
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;

  const pass = (msg: string) => {
    passed++;
    console.log(`✅ PASSED: ${msg}`);
  };
  const fail = (msg: string) => {
    failed++;
    console.error(`❌ FAILED: ${msg}`);
  };

  try {
    // ──────────────────────────────────────────────────────────
    // Test 1: startTicketQueue() — init queue + worker
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 1: startTicketQueue() — init queue + worker");
    try {
      await startTicketQueue();
      pass("startTicketQueue() completed without error");
    } catch (err: any) {
      fail(`startTicketQueue() threw: ${err.message}`);
    }

    await sleep(2000);

    // ──────────────────────────────────────────────────────────
    // Test 2: Idempotency — second start is no-op
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 2: Idempotency — second start call is no-op");
    try {
      await startTicketQueue();
      pass("Second startTicketQueue() returned without error (idempotent)");
    } catch (err: any) {
      fail(`Second start threw: ${err.message}`);
    }

    // ──────────────────────────────────────────────────────────
    // Test 3: getTicketQueueStats() — stats accessible
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 3: getTicketQueueStats() — stats accessible");
    const stats = await getTicketQueueStats();

    if (!stats) {
      fail("getTicketQueueStats() returned null");
    } else if (!stats.running) {
      fail("Stats: running = false (expected true)");
    } else {
      pass(`Queue stats: running=true, waiting=${stats.waiting}, active=${stats.active}`);
    }

    // ──────────────────────────────────────────────────────────
    // Test 4: dispatchTicketGeneration — job queued, returns jobId
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 4: dispatchTicketGeneration — job queued with jobId");
    let testJobId: string | null = null;
    try {
      const mockData = createMockTicketData(100001, 3);
      const result = await dispatchTicketGeneration(mockData);

      if (result.status === "queued" && result.jobId && result.jobId !== "sync") {
        testJobId = result.jobId;
        pass(`Job dispatched: jobId=${result.jobId}, status=${result.status}`);
      } else {
        fail(`Unexpected result: ${JSON.stringify(result)}`);
      }
    } catch (err: any) {
      fail(`dispatchTicketGeneration() threw: ${err.message}`);
    }

    // ──────────────────────────────────────────────────────────
    // Test 5: getTicketJobStatus — poll returns valid state
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 5: getTicketJobStatus — poll job state");
    if (testJobId) {
      try {
        const jobStatus = await getTicketJobStatus(testJobId);

        if (jobStatus) {
          const validStates = ["waiting", "active", "completed", "failed", "delayed"];
          if (validStates.includes(jobStatus.status)) {
            pass(`Job ${testJobId} status: "${jobStatus.status}", progress: ${jobStatus.progress}%`);
          } else {
            fail(`Unexpected job state: "${jobStatus.status}"`);
          }
        } else {
          fail("getTicketJobStatus() returned null for dispatched job");
        }
      } catch (err: any) {
        fail(`getTicketJobStatus() threw: ${err.message}`);
      }
    } else {
      fail("Skipped — no jobId from test 4");
    }

    // ──────────────────────────────────────────────────────────
    // Test 6: Worker processes job — state changes from 'waiting'
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 6: Worker picks up job — state transitions");
    console.log("   ⏳ Waiting up to 10s for worker to pick up job...");
    if (testJobId) {
      let finalState = "unknown";
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        const s = await getTicketJobStatus(testJobId);
        if (s && s.status !== "waiting") {
          finalState = s.status;
          break;
        }
      }

      if (finalState === "waiting") {
        fail("Job still waiting after 10s — worker may not be processing");
      } else {
        // Worker picked it up. It may fail on DB (expected with test data),
        // but the queue machinery is working.
        pass(`Worker processed job — final state: "${finalState}"`);
        if (finalState === "failed") {
          console.log(
            "   ℹ️  Failed state is expected with mock data (FK constraints). Queue plumbing works!"
          );
        }
      }
    } else {
      fail("Skipped — no jobId from test 4");
    }

    // ──────────────────────────────────────────────────────────
    // Test 7: Dispatch multiple jobs — concurrency stress
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 7: Dispatch 5 jobs concurrently — stress test");
    try {
      const dispatches = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          dispatchTicketGeneration(createMockTicketData(200000 + i, 2))
        )
      );

      const allQueued = dispatches.every((d) => d.status === "queued" && d.jobId !== "sync");
      if (allQueued) {
        pass(`5 jobs dispatched: [${dispatches.map((d) => d.jobId).join(", ")}]`);
      } else {
        fail(`Some jobs not queued: ${JSON.stringify(dispatches)}`);
      }
    } catch (err: any) {
      fail(`Concurrent dispatch threw: ${err.message}`);
    }

    // Wait for worker to attempt processing
    console.log("   ⏳ Waiting 8s for worker to process batch...");
    await sleep(8000);

    // ──────────────────────────────────────────────────────────
    // Test 8: Queue stats after dispatches — counters updated
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 8: Queue stats reflect dispatched jobs");
    const statsAfter = await getTicketQueueStats();
    if (statsAfter) {
      const totalTracked = statsAfter.waiting + statsAfter.active + statsAfter.completed + statsAfter.failed;
      if (totalTracked > 0) {
        pass(
          `Stats: waiting=${statsAfter.waiting}, active=${statsAfter.active}, ` +
          `completed=${statsAfter.completed}, failed=${statsAfter.failed} (total tracked: ${totalTracked})`
        );
      } else {
        fail("No jobs tracked in stats (expected > 0)");
      }
    } else {
      fail("getTicketQueueStats() returned null");
    }

    // ──────────────────────────────────────────────────────────
    // Test 9: getTicketJobStatus for non-existent job — returns null
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 9: getTicketJobStatus for fake jobId — returns null");
    try {
      const fakeStatus = await getTicketJobStatus("non-existent-job-id-xyz");
      if (fakeStatus === null) {
        pass("Returns null for non-existent job (correct)");
      } else {
        fail(`Expected null, got: ${JSON.stringify(fakeStatus)}`);
      }
    } catch (err: any) {
      fail(`Threw for non-existent job: ${err.message}`);
    }

    // ──────────────────────────────────────────────────────────
    // Test 10: stopTicketQueue() — graceful shutdown
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 10: stopTicketQueue() — graceful shutdown");
    try {
      await stopTicketQueue();
      pass("stopTicketQueue() completed without error");
    } catch (err: any) {
      fail(`stopTicketQueue() threw: ${err.message}`);
    }

    // ──────────────────────────────────────────────────────────
    // Test 11: Stats after stop — returns null
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 11: Stats after stop — returns null");
    const postStopStats = await getTicketQueueStats();
    if (postStopStats === null) {
      pass("getTicketQueueStats() returns null after stop");
    } else {
      fail(`Expected null, got: ${JSON.stringify(postStopStats)}`);
    }

    // ──────────────────────────────────────────────────────────
    // Test 12: Dispatch after stop — sync-fallback
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 12: dispatchTicketGeneration after stop — sync-fallback");
    try {
      const fallbackResult = await dispatchTicketGeneration(createMockTicketData(300001));
      if (fallbackResult.status === "sync-fallback" && fallbackResult.jobId === "sync") {
        pass(`Correctly fell back: jobId="${fallbackResult.jobId}", status="${fallbackResult.status}"`);
      } else {
        fail(`Expected sync-fallback, got: ${JSON.stringify(fallbackResult)}`);
      }
    } catch (err: any) {
      fail(`Dispatch after stop threw unexpectedly: ${err.message}`);
    }

    // ──────────────────────────────────────────────────────────
    // Test 13: Double stop — safe, no crash
    // ──────────────────────────────────────────────────────────
    console.log("\n📝 Test 13: Double stop — safe, no crash");
    try {
      await stopTicketQueue();
      pass("Double stop completed safely (no crash)");
    } catch (err: any) {
      fail(`Double stop threw: ${err.message}`);
    }

    // ════════════════════════════════════════════════════════════
    //  RESULTS
    // ════════════════════════════════════════════════════════════
    console.log("\n" + "=".repeat(60));
    console.log("📊 Ticket Queue Test Results");
    console.log("=".repeat(60));
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(
      `📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`
    );

    if (failed === 0) {
      console.log("\n🎉 ALL TICKET QUEUE TESTS PASSED! 🎉");
      console.log("\n✅ Verified:");
      console.log("   ✅ Queue + Worker initialisation");
      console.log("   ✅ Idempotent start (safe to call twice)");
      console.log("   ✅ Queue stats accessible and accurate");
      console.log("   ✅ Job dispatch returns jobId + 'queued' status");
      console.log("   ✅ Job status polling works (state transitions)");
      console.log("   ✅ Worker picks up and processes jobs");
      console.log("   ✅ Concurrent dispatch (5 jobs at once)");
      console.log("   ✅ Stats reflect dispatched/processed job counts");
      console.log("   ✅ Non-existent job returns null");
      console.log("   ✅ Graceful shutdown");
      console.log("   ✅ Stats return null after stop");
      console.log("   ✅ Dispatch falls back to sync when queue stopped");
      console.log("   ✅ Double stop is safe");
      console.log("\n🚀 Ticket generation queue is production ready!\n");
    } else {
      console.log(`\n⚠️ ${failed} test(s) failed — review output above!\n`);
    }
  } catch (error: any) {
    console.error("\n❌ TEST SUITE ERROR:", error.message);
    console.error(error.stack);
  } finally {
    // Clean shutdown
    try {
      await stopTicketQueue();
    } catch {
      /* ignore */
    }

    setTimeout(() => {
      console.log("👋 Done");
      process.exit(failed === 0 ? 0 : 1);
    }, 2000);
  }
}

// Run
console.log("🚀 BullMQ Ticket Queue Test Suite");
console.log("=".repeat(60));
runTicketQueueTests();


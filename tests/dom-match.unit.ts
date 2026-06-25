import assert from "node:assert/strict";
import { matchDomSnapshot } from "../src/services/agent-dom.service.js";

function html(label: string, noise: string) {
  return `<!doctype html>
    <html>
      <head>
        <meta property="og:image" content="https://cdn.example.test/${noise}.png" />
        <script src="/assets/${noise}.js"></script>
      </head>
      <body>
        <main>
          <form>
            <label for="full-name">Full Name</label>
            <input id="full-name" name="fullName" />
            <label for="email">Email</label>
            <input id="email" name="email" type="email" />
            <label for="location">Location</label>
            <select id="location" name="location"><option>Dubai</option></select>
            <button type="submit">${label}</button>
          </form>
        </main>
      </body>
    </html>`;
}

async function run() {
  const portalId = `por_dom_unit_${Date.now()}`;
  const base = {
    portalId,
    url: "https://quote.example.test/new",
    step: "submission_form",
    visibleLabels: ["Full Name", "Email", "Location"],
    reason: "unit-test"
  };

  const first = await matchDomSnapshot({
    ...base,
    jobId: "JOB-DOM-1",
    currentSanitizedDom: html("Generate Quotation PDF", "chunk-a-123456")
  });
  assert.equal(first.mode, "first_observation_stored");

  const sameFormWithNoise = await matchDomSnapshot({
    ...base,
    jobId: "JOB-DOM-2",
    currentSanitizedDom: html("Generate Quotation PDF", "chunk-b-987654")
  });
  assert.notEqual(sameFormWithNoise.mode, "changed_pending_review");
  assert.equal(sameFormWithNoise.snapshotId, first.snapshotId);

  const changedForm = await matchDomSnapshot({
    ...base,
    jobId: "JOB-DOM-3",
    currentSanitizedDom: html("Create Quote", "chunk-c-555555").replace("Location", "Residence Emirate")
  });
  assert.equal(changedForm.mode, "changed_pending_review");

  const revertedToApproved = await matchDomSnapshot({
    ...base,
    jobId: "JOB-DOM-4",
    currentSanitizedDom: html("Generate Quotation PDF", "chunk-d-222222")
  });
  assert.notEqual(revertedToApproved.mode, "changed_pending_review");
  assert.equal(revertedToApproved.snapshotId, first.snapshotId);

  console.log("dom-match-unit-ok");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

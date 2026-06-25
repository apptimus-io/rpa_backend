import assert from "node:assert/strict";
import { decryptSecret, encryptSecret } from "../src/services/credentials.service.js";

function run() {
  const plaintext = "fixture-portal-password";
  const encrypted = encryptSecret(plaintext);

  assert.notEqual(encrypted, plaintext);
  assert.equal(encrypted.split(".").length, 3);
  assert.equal(decryptSecret(encrypted), plaintext);
  assert.equal(encrypted.includes(plaintext), false);

  assert.throws(
    () => decryptSecret("not-a-valid-encrypted-payload"),
    /Invalid encrypted secret payload/
  );

  console.log("credentials-unit-ok");
}

run();

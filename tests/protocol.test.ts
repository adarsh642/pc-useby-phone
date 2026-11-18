import assert from "node:assert/strict";
import test from "node:test";
import { validateKeyboardMessage } from "../apps/android-client/src/protocol.ts";
import { deviceAuthSchema, pairingCreateSchema, pairingJoinSchema } from "../apps/signaling-server/src/protocol.ts";

test("accepts valid keyboard text and allowlisted keys", () => {
  assert.equal(validateKeyboardMessage({ type: "text", text: "hello" }), true);
  assert.equal(validateKeyboardMessage({ type: "key", key: "Enter", modifiers: ["Ctrl"] }), true);
});

test("rejects malformed or unsafe keyboard messages", () => {
  assert.equal(validateKeyboardMessage({ type: "text", text: "x".repeat(2049) }), false);
  assert.equal(validateKeyboardMessage({ type: "key", key: "F12" }), false);
  assert.equal(validateKeyboardMessage({ type: "key", key: "Enter", modifiers: ["Ctrl", "Ctrl"] }), false);
  assert.equal(validateKeyboardMessage({ type: "key", key: "Enter", modifiers: ["Meta"] }), false);
});

test("enforces pairing and device identity constraints", () => {
  assert.equal(pairingCreateSchema.safeParse({ deviceId: "windows-device-1234", deviceName: "PC" }).success, true);
  assert.equal(pairingCreateSchema.safeParse({ deviceId: "short", deviceName: "PC" }).success, false);
  assert.equal(pairingJoinSchema.safeParse({
    pairingId: "ABCD23",
    secret: "Abcd123456",
    deviceId: "android-device-1234",
    deviceName: "Phone"
  }).success, true);
  assert.equal(deviceAuthSchema.safeParse({
    deviceId: "windows-device-1234",
    deviceName: "PC",
    publicKey: "a".repeat(32)
  }).success, true);
});

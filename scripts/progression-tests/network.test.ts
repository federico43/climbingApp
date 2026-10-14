// Tests for utils/network.ts (offline vs wrong credentials on sign-in). Run:
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/network.test.ts

import assert from "node:assert/strict"
import { authErrorKind, canReachServer, isNetworkError } from "@/utils/network"

const appwrite = (message: string, code: number, type = "") => Object.assign(new Error(message), { name: "AppwriteException", code, type })

// fetch rejections (React Native / browsers) → offline
assert.equal(isNetworkError(new TypeError("Network request failed")), true)
assert.equal(isNetworkError(new TypeError("Failed to fetch")), true)
assert.equal(isNetworkError(new TypeError("Load failed")), true)
assert.equal(isNetworkError(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })), true)
// the server answered → not offline
assert.equal(isNetworkError(appwrite("Invalid credentials. Please check the email and password.", 401, "user_invalid_credentials")), false)
assert.equal(isNetworkError(appwrite("Server error", 500)), false)
assert.equal(isNetworkError(new TypeError("Cannot read properties of undefined")), false)
assert.equal(isNetworkError(null), false)
// an AppwriteException with code 0 wrapping a network failure → offline
assert.equal(isNetworkError(appwrite("Network request failed", 0)), true)

assert.equal(authErrorKind(new TypeError("Network request failed")), "network")
assert.equal(authErrorKind(appwrite("Invalid credentials. Please check the email and password.", 401, "user_invalid_credentials")), "credentials")
assert.equal(authErrorKind(appwrite("Invalid `password` param: Password must be between 8 and 256 characters long.", 400, "general_argument_invalid")), "credentials")
assert.equal(authErrorKind(appwrite("Rate limit for the current endpoint has been exceeded.", 429, "general_rate_limit_exceeded")), "other")

// nothing listens on this port → unreachable, quickly
assert.equal(await canReachServer("http://127.0.0.1:9/", 2000), false)

console.log("all network tests passed")

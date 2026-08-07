import { InMemoryTripStore } from "./in-memory-store.js";
import { tripStoreContractTests } from "./store.contract.js";

// No `users` harness: this fake has no users table and no foreign key, so there
// is nothing to provision. Only the Neon run (scripts/check-neon.test.ts) proves
// a trip cannot be claimed by a user id that does not exist.
tripStoreContractTests("in-memory", { createStore: () => new InMemoryTripStore() });

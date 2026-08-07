import { InMemoryAuthStore } from "./in-memory-store.js";
import { authStoreContractTests } from "./store.contract.js";

authStoreContractTests("in-memory", () => new InMemoryAuthStore());

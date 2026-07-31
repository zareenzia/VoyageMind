import { InMemoryTripStore } from "./in-memory-store.js";
import { tripStoreContractTests } from "./store.contract.js";

tripStoreContractTests("in-memory", () => new InMemoryTripStore());

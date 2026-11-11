import * as leakcheck from "./leakcheck.js";
import * as osintleak from "./osintleak.js";
import * as snusbase from "./snusbase.js";
import * as hibp from "./hibp.js";
import * as dehashed from "./dehashed.js";
import * as xposedornot from "./xposedornot.js";

export const PROVIDERS = { leakcheck, osintleak, snusbase, hibp, dehashed, xposedornot };

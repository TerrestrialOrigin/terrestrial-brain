// The Step 7 / v1.5 capability seam for the eval scenarios.
//
// Each eval scenario scores real model behavior over a labeled fixture set, but
// the behavior it scores is produced by a Step 7 (or v1.5) capability that does
// not exist yet. Until then, `evalCapability(...)` raises a single documented
// pending reason, so an opt-in eval run with a key fails loudly (pass-rate 0 <
// threshold, naming the missing capability) rather than pretending to pass.
// Step 7 wires these to the real pipeline and the fixtures become live scoring.

export function evalPending(milestone: string, slug: string): never {
  throw new Error(
    `PENDING(${milestone}:${slug}) eval capability not yet implemented; ` +
      `Step 7 (or v1.5) wires this seam to the real pipeline`,
  );
}

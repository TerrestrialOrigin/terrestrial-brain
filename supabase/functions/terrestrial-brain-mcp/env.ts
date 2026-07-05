// Fail-fast environment-variable access (fix-plan Step 10, finding X5).
//
// Reading a required secret with `Deno.env.get(NAME)!` silences the compiler's
// `string | undefined` and lets an `undefined` flow into runtime logic — a
// missing OPENROUTER_API_KEY becomes `Authorization: Bearer undefined`, a missing
// MCP_ACCESS_KEY silently breaks auth. `requireEnv` refuses to hand back an
// absent value: it throws an error naming the variable so the failure surfaces
// at the point of use (or at cold start, for composition-root reads) instead of
// far away as a corrupt request.

/**
 * Return the value of the named environment variable, or throw naming it when
 * the variable is unset or empty. An empty string is treated as missing — an
 * empty secret is never a valid configuration.
 */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") {
    throw new Error(
      `Required environment variable ${name} is not set. ` +
        `Configure it before starting the function.`,
    );
  }
  return value;
}

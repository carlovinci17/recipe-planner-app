// Stub for the `server-only` package in the node test environment. The real
// module throws when imported outside a React Server Component; services begin
// with `import "server-only"`, so we alias it to this no-op (see vitest.config.ts).
export {};

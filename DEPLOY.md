# Deploy — Cloudflare Pages → lathe.naklitechie.com

Lathe is a fully static build with **no backend** (a server would break the sovereignty
invariant — handoff §1). The actual deploy + DNS is **owner-gated** (needs the Cloudflare
account and the `naklitechie.com` zone); these are the steps.

## Build

```sh
pnpm install
pnpm build        # → dist/  (index.html, assets/, the OCCT .wasm, and public/_headers)
```

`public/_headers` is copied into `dist/` and applied by Cloudflare Pages — it carries the shipped
security posture (handoff §8): a strict **document** CSP (no `unsafe-eval`) and a permissive
**worker** CSP (`/assets/*`, which needs `unsafe-eval` for the emscripten Embind kernel — confined
to the DOM-less, keyless kernel worker). See `SPIKE-FINDINGS.md` → "Security finding".

## Deploy (Cloudflare Pages)

Direct upload (simplest), via Wrangler:

```sh
pnpm dlx wrangler pages deploy dist --project-name=lathe
```

Or connect the GitHub repo (`NakliTechie/lathe`) in the Cloudflare dashboard with build command
`pnpm build` and output directory `dist`.

## Custom domain + DNS

1. Pages project → **Custom domains** → add `lathe.naklitechie.com`.
2. Cloudflare creates the `CNAME` in the `naklitechie.com` zone automatically (proxied).

## Verify after deploy (the one check that needs the live edge)

`vite preview` does **not** apply `_headers`, so the CSP split can only be verified live:

```sh
# document is strict (no 'unsafe-eval'):
curl -sI https://lathe.naklitechie.com/ | grep -i content-security-policy
# a worker/asset bundle is permissive (has 'unsafe-eval'); inert except when loaded AS a worker:
curl -sI https://lathe.naklitechie.com/assets/ | grep -i content-security-policy
```

Then open the site: the reference part should render, **Run** / param edits should work, and STEP
export should produce a file that opens in FreeCAD. BYOK codegen needs a real Anthropic key (the
key never leaves the browser except to `api.anthropic.com`).

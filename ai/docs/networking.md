# Network and DNS change control

No DNS, nameserver, router, firewall, certificate or Cloudflare account setting has been changed by this implementation.

## Preserve Namecheap hosting

Changing DNS authority is not moving website hosting. The root/www records can continue pointing to Namecheap while a new `ai.alext.io` hostname routes to a Cloudflare Tunnel. However, changing authoritative nameservers can disrupt web and email service if records or DNSSEC are mishandled.

Before requesting approval, export the authoritative zone from the current DNS provider and inventory A, AAAA, CNAME, MX, TXT, SPF, all actual DKIM selectors, DMARC, CAA, SRV, verification records, redirects and relevant DNSSEC/DS state. Public queries alone cannot enumerate every DKIM selector or private/unknown record. Record TTLs, current nameservers, registrar settings, mail routing and a rollback plan. Compare the imported zone before any cutover. Coordinate DNSSEC/registrar DS transitions deliberately to avoid validation failures.

Cloudflare's partial CNAME setup documentation currently limits that mode to Business or Enterprise plans. Do not assume a free account can keep another authoritative DNS provider using that configuration. Confirm the actual account's plan and supported zone setup. Do not buy an upgrade or migrate nameservers without explicit approval.

Source: https://developers.cloudflare.com/dns/zone-setups/partial-setup/

## Tunnel configuration

Create a narrowly scoped tunnel credential through the provider's secure interface. Store its credential JSON only in `secrets/tunnel-credentials.json`. The connector does not receive an account-wide management certificate. Render the approved UUID into the local configuration using `scripts/render-tunnel.mjs` after secure local configuration exists.

Ingress matches only `ai.alext.io` and `/v1/session`, `/v1/chat`, `/v1/chat/stream`, `/v1/health`; the final catch-all returns 404. The gateway independently checks methods, exact paths, Origin, Host and the connector peer. The configured fixed bridge addresses force the connector through the intended trusted interface. Review `10.97.0.0/28`, `10.97.1.0/28`, and `10.97.2.0/28` for conflicts before creation. Never attach the connector directly to the inference network.

There are no Compose host port publications, host networking or router forwards. The standard model service has only an internal network. The maintenance model-loader has outbound access only while explicitly run. Gateway outbound access is needed for Turnstile; it is not a claim of a complete egress firewall against a compromised gateway process.

Verify actual connector source addresses, `CF-Connecting-IP` behavior and the absence of conflicting Cloudflare Workers/proxy rules. Disable caching for the API and preserve streaming. Do not place a browser-interactive Access login in front of anonymous CORS preflight unless the product design is deliberately changed. Use WAF/rate controls only after verifying what the account plan provides; backend limits do not depend on paid edge features.

## Turnstile

Configure the exact hostname `alext.io`; the public site key goes into the approved widget build. The secret stays in the gateway's file mount. The frontend uses action `portfolio_session`; the server validates hostname, action, age, success and reuse. Do not deploy official test keys or a testing verification endpoint.

## External acceptance

Use a genuinely external client, such as a phone on cellular, to verify website health, API readiness, real chat, streaming and Stop behavior. Check forbidden raw Ollama paths and verify no model/SSH/admin ports were exposed by router settings, Docker publishing or other tunnels. Screenshots of a dashboard alone are insufficient; collect HTTP responses, controlled real-model evidence and actual local listener/container configuration as well.

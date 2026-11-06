# EtherLens

React + JavaScript wallet explorer built with Vite. Public Ethereum Mainnet addresses only.

## Development

1. Run `npm install`.
2. Copy `.env.example` to `.env` in the project root.
3. Set these server-only environment variables:
   - `ETH_RPC_URL`: HTTPS Ethereum Mainnet JSON-RPC endpoint. Create an Ethereum Mainnet app at https://dashboard.alchemy.com/ or https://developer.metamask.io/ and copy its RPC URL (including its key).
   - `ETHERSCAN_API_KEY`: create a key at https://etherscan.io/myapikey. Your Etherscan plan must support the requested endpoints.
   - `PORT`: optional proxy port; default `3001`. If changed, update the target in vite.config.js.
4. Terminal 1: `npm run server` (Node watch mode).
5. Terminal 2: `npm run dev`; open the printed Vite URL.

Restart the proxy after editing .env. No credentials use VITE_ variables. Missing keys show setup-required errors; no invented data or fiat prices are shown.

Alternatively, stop any existing frontend/proxy processes and run `npm run dev:all` to start both from one terminal. Open http://127.0.0.1:5173/ and keep that terminal running. If port 5173 is already occupied, stop the older Vite process first. This command uses the default proxy port 3001.

## Production

Run `npm run build`. Set `NODE_ENV=production`, `ETH_RPC_URL`, `ETHERSCAN_API_KEY`, and optionally `PORT` in your server environment; run `npm start`. Express serves dist and /api on 127.0.0.1. Put an HTTPS reverse proxy in front of it. Keep API same-origin; do not deploy dist alone without routing /api to this Node service. Bindings are intentionally local. Configure trusted reverse proxies and request limits for your deployment before exposing it at scale. Never publish .env.

## Checks

`npm run lint`, `npm test`, `npm run build`.

## Data and coverage

Balance and receipt details use ethers v6 and the configured RPC. Indexed history uses fixed https://api.etherscan.io/v2/api with chainid=1 and documented txlist, txlistinternal, tokentx actions:
- https://docs.etherscan.io/api-reference/endpoint/txlist
- https://docs.etherscan.io/api-reference/endpoint/txlistinternal
- https://docs.etherscan.io/api-reference/endpoint/tokentx

Pages contain 100 records, newest first, with a local 100-page cap. Requests are serialized at least 550ms apart and time out after 15s. The proxy enforces 90 requests/minute/IP. Provider errors remain errors, distinct from no activity. Filters apply to loaded records only. Load more extends that coverage. Rapid address/dataset changes abort old requests and ignore stale responses. Normal and internal records deduplicate by hash and hash/trace ID. Token logIndex is used when provided; Etherscan responses without logIndex use stable page and row identity to preserve identical legitimate events. Changing chain indexing during pagination can therefore produce boundary duplication for token responses without log indexes; refresh before generating a statement if indexing changes.

All CSV/PDF downloads are explicitly PARTIAL statements of every loaded record matching the filters (not only the visible UI page). No claim of complete lifetime coverage is made, even at the indexed end. Load older pages before exporting to widen coverage. Exports include all full addresses, exact decimal amounts, UTC dates, filters, source and coverage, current balance and observation time. CSV fields are quoted and protected against formula injection. jsPDF AutoTable repeats headers and wraps long values across pages. PDF generation loads on demand and displays progress.

Received/sent ETH totals exclude failed and self transfers. Fees are attributed only to the sender in the normal dataset, including failed transaction gas, and never duplicated across internal or token events. Contract creation and zero values are retained. Internal activity follows the provider's trace coverage (not a full ledger). ERC-20 transfers are not holdings and assets are never combined. NFTs, beacon withdrawals, rollups and pending indexed history are outside this implementation. Indexed token status is labeled Indexed; inspect details for an RPC receipt. Charts show transfer activity grouped by UTC date, never historical balance. Individual daily bar values are available through accessible labels and tooltips.

Without valid RPC and Etherscan credentials, live balances, funded/empty-address histories and upstream pagination cannot be verified. Browser checks and export checks should be distinguished from live provider verification.

## Sepolia testnet

Use the header network selector or a share URL with `network=sepolia`. Mainnet remains the default for URLs without a network. Balances, receipts, history, Etherscan links and exports use the selected network and stay separate. Sepolia uses chain ID 11155111 and https://sepolia.etherscan.io. Test ETH is labeled as testnet data.

Set `SEPOLIA_RPC_URL` to your full Ethereum Sepolia HTTPS RPC endpoint. If omitted and ETH_RPC_URL uses Alchemy's eth-mainnet.g.alchemy.com host, the server reuses that app key with Alchemy's documented eth-sepolia.g.alchemy.com host; Sepolia must be enabled for the app. Explicit SEPOLIA_RPC_URL takes priority. Provider chain IDs are verified before reading data. The same Etherscan V2 key is used with the selected chainid. This extends the initial Mainnet-only implementation.

Verified live for the user's public address after enabling Sepolia support: RPC balance and normal history returned successfully; Mainnet and Sepolia produce separate results. Unsupported network requests return HTTP 400. Internal/token Sepolia histories and Sepolia receipt retrieval were not separately live-tested.

## Sepolia data provider: Blockscout (current)

Sepolia now uses the requested fixed instance `https://eth-sepolia.blockscout.com/api/v2` for its indexed balance, transaction details, normal history, internal transfers and ERC-20 transfers. Sepolia no longer requires an RPC URL or Etherscan key. Existing RPC / Etherscan configuration remains used for Mainnet. Earlier Sepolia RPC setup instructions above describe the previous implementation.

Routes used: `/addresses/{address}`, `/addresses/{address}/transactions`, `/addresses/{address}/internal-transactions`, `/addresses/{address}/token-transfers?type=ERC-20`, and `/transactions/{hash}`. The server validates addresses, hashes, datasets and a bounded, wallet/dataset-bound cursor; hosts are fixed. Requests are spaced by at least 550ms, time out after 15 seconds, reject redirects, and return provider failures separately from empty results. Load more follows the provider's `next_page_params` through an opaque validated cursor, with a 100-page local cap. No key is sent to Blockscout.

Balance is Blockscout's last indexed balance, with indexed block and retrieval time displayed and exported; it can lag chain state. Actual fees are attributed only in normal transactions when the searched wallet is the sender. Pending values do not enter successful ETH totals. Token events deduplicate by transaction hash and log index. If the indexer lacks token decimals, amounts are explicitly labeled raw units rather than assuming 18 decimals; the token contract remains included. Empty internal history is valid.

Docs: https://docs.blockscout.com/api-reference/get-address-transactions and related address routes. The requested per-instance API is currently responding, but official docs mark per-instance routes for future deprecation in favor of the Universal API. This integration deliberately uses the instance the user requested and reports failures rather than silently switching providers.

## Default network and normal browser entry

Open http://localhost:5173/ or http://127.0.0.1:5173/ directly and enter a public address. Sepolia is now the default in both frontend and API. No custom URL or Sepolia .env credentials are needed. The network selector remains available and remembers the last explicit network per browser origin. A shared link with an explicit network takes priority over that saved selection. These defaults replace the initial Mainnet defaults documented above.

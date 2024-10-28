# Wallet Address Processor Tool

## Overview
Processes Bech32 wallet addresses (`sei1...`). Retrieves public keys, generates correct EVM hex address for it, and stores the results in a SQLite db.

## Setup
### Prerequisites
- **Node.js** (v14+ recommended)
- **Yarn** or **npm**

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/wallet-processor.git
   cd wallet-processor
   ```
2. Install dependencies:
   ```bash
   yarn install
   ```

## Usage
### Database Setup
On first run, the tool creates an SQLite database (`wallets.db`) with the `wallet_associations` table, which stores:
- `wallet_address`, `pubkey`, `generated_evm_address`, and `failed_attempts`.

**Note**: Populate the `wallet_address` column with Bech32 addresses before running the tool.

### Running the Tool
To start processing:
```bash
node main.js
```
This will:
- Load unprocessed wallet addresses from the database.
- Distribute tasks to worker threads for public key retrieval and address generation.
- Update the database with the results.

### Configuration
- **Concurrency Limit**: Set in `main.js` (`CONCURRENCY_LIMIT`, default `6`).
- **Batch Size**: Modify `batchSize` in `main.js` (default `80`).
- **API Endpoints**: Update `apiEndpoints` in `worker.js`.

## Dependencies
- **better-sqlite3**: SQLite database access.
- **node-fetch**: HTTP requests.
- **@cosmjs/encoding**, **@noble/hashes**, **bech32**: Cryptographic operations.

## License
Licensed under the MIT License.


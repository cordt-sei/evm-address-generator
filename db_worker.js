// db_worker.js

import { parentPort } from 'worker_threads';
import Database from 'better-sqlite3';

const db = new Database('./wallets.db');

function batchInsert(batch) {
  const insertStmt = db.prepare(`
      INSERT INTO wallet_associations (wallet_address, pubkey, generated_evm_address)
      VALUES (?, ?, ?)
      ON CONFLICT(wallet_address) DO UPDATE SET pubkey = excluded.pubkey, generated_evm_address = excluded.generated_evm_address
  `);
  const transaction = db.transaction((batch) => {
      for (const { walletAddress, pubKey, ethAddress } of batch) {
          insertStmt.run(walletAddress, pubKey, ethAddress);
      }
  });

  transaction(batch);
}

parentPort.on('message', ({ type, batch }) => {
  if (type === 'db_update') {
      try {
          batchInsert(batch);
          parentPort.postMessage({ type: 'db_update_completed', batch });
      } catch (error) {
          parentPort.postMessage({ type: 'db_update_error', error: error.message });
      }
  } else if (type === 'terminate') {
      console.log(`[DB Worker] Terminating and closing database connection.`);
      db.close();  // Close the database connection
      process.exit(0);  // Exit the worker
  }
});

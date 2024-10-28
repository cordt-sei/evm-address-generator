// Main script for standalone wallet address processor
import { Worker } from 'worker_threads';
import Database from 'better-sqlite3';
import fs from 'fs';

// Setup SQLite Database
const dbFilePath = './indexer.db';
if (!fs.existsSync(dbFilePath)) {
    console.log('[Setup] Database not found. Creating a new database...');
    const db = new Database(dbFilePath);
    db.prepare(`
        CREATE TABLE IF NOT EXISTS wallet_associations (
            wallet_address TEXT PRIMARY KEY,
            pubkey TEXT,
            generated_evm_address TEXT,
            failed_attempts INTEGER DEFAULT 0
        );
    `).run();
    console.log('[Setup] Database created successfully.');
    db.close();
}

const db = new Database(dbFilePath);
const CONCURRENCY_LIMIT = 6; // Number of worker threads
let taskQueue = []; // Queue of wallet addresses to process
let activeWorkers = 0;
let tasksCompleted = 0;
const workerPool = [];
const batchSize = 80; // Size of each batch of tasks sent to workers

// Load wallet addresses into the task queue where the evm_address is NULL and failed_attempts are under the limit
function loadTasks() {
    const rows = db.prepare('SELECT wallet_address FROM wallet_associations WHERE evm_address IS NULL AND (failed_attempts < 3 OR failed_attempts IS NULL)').all();
    taskQueue = rows.map(row => row.wallet_address);
    console.log(`[Main] Loaded ${taskQueue.length} tasks into the queue.`);
    if (taskQueue.length === 0) {
        console.log(`[Main] No tasks to process. Exiting.`);
        db.close();
        process.exit(0);
    }
}

function distributeWork() {
    console.log(`[Main] Distributing work with concurrency limit: ${CONCURRENCY_LIMIT}`);
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
        startWorker();
    }
}

function startWorker() {
    if (taskQueue.length === 0) {
        if (activeWorkers === 0) {
            console.log(`[Main] All tasks are completed and all workers have exited.`);
            db.close();
            process.exit(0);
        }
        return;
    }

    const taskBatch = taskQueue.splice(0, batchSize); // Take the next batch of tasks
    if (taskBatch.length > 0) {
        activeWorkers++;
        const worker = new Worker('./worker.js', { workerData: { tasks: taskBatch } });
        workerPool.push(worker);

        worker.on('message', handleWorkerMessage);
        worker.on('error', handleWorkerError);
        worker.on('exit', handleWorkerExit);
    }
}

function handleWorkerMessage(message) {
    const { type, batch, walletAddress } = message;
    if (type === 'db_update_completed') {
        tasksCompleted += batch.length;
        console.log(`[Main] Completed ${tasksCompleted} tasks so far.`);
        startWorker(); // Start another worker if more tasks are available
    } else if (type === 'db_update_error') {
        console.error(`[Main] Error during DB update: ${message.error}`);
    } else if (type === 'fetch_failed') {
        db.prepare('UPDATE wallet_associations SET failed_attempts = failed_attempts + 1 WHERE wallet_address = ?').run(walletAddress);
        console.log(`[Main] Failed to fetch pubkey for ${walletAddress}, marked as failed.`);
        startWorker(); // Start another worker if more tasks are available
    }
}

function handleWorkerError(error) {
    console.error(`[Main] Worker error: ${error.message}`);
}

function handleWorkerExit(code) {
    activeWorkers--;
    if (code !== 0) {
        console.error(`[Main] Worker exited with code ${code}`);
    }
    if (taskQueue.length === 0 && activeWorkers === 0) {
        console.log(`[Main] All tasks completed.`);
        db.close();
        process.exit(0);
    }
}

// Load initial tasks and distribute work
loadTasks();
distributeWork();

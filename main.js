// main.js

import { Worker } from 'worker_threads';
import Database from 'better-sqlite3';

const db = new Database('./wallets.db');
const dbWorker = new Worker('./db_worker.js');  // New dedicated worker for DB updates
const CONCURRENCY_LIMIT = 6; 
let taskQueue = [];
let activeWorkers = 0;
let tasksCompleted = 0;
const workerPool = [];
const batchSize = 80;

function loadTasks() {
    const rows = db.prepare('SELECT wallet_address FROM wallet_associations WHERE generated_evm_address IS NULL').all();
    taskQueue = rows.map(row => row.wallet_address);
    console.log(`[Main] Loaded ${taskQueue.length} tasks into the queue.`);
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
        }
        return;
    }

    const taskBatch = taskQueue.splice(0, batchSize);
    activeWorkers++;
    const worker = new Worker('./worker.js', { workerData: { tasks: taskBatch } });
    workerPool.push(worker);

    worker.on('message', handleWorkerMessage);
    worker.on('error', handleWorkerError);
    worker.on('exit', handleWorkerExit);
}

function handleWorkerMessage(message) {
    const { type, batch } = message;
    if (type === 'db_update_completed') {
        tasksCompleted += batch.length;
        console.log(`[Main] Completed ${tasksCompleted} tasks so far.`);
        dbWorker.postMessage({ type: 'db_update', batch });  // Send to db_worker.js
        startWorker();
    } else if (type === 'db_update_error') {
        console.error(`[Main] Error during DB update: ${message.error}`);
    }
}

dbWorker.on('message', (message) => {
    if (message.type === 'db_update_completed') {
        console.log(`[DB Worker] Database update completed for batch.`);
    } else if (message.type === 'db_update_error') {
        console.error(`[DB Worker] Database update error: ${message.error}`);
    }
});

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
        
        // Terminate all workers in workerPool
        workerPool.forEach(worker => worker.terminate());
        
        // Terminate db_worker and close the database
        dbWorker.postMessage({ type: 'terminate' });
        dbWorker.on('exit', () => {
            console.log(`[Main] All workers and DB connections are closed. Exiting process.`);
            process.exit(0);  // Explicitly exit the process
        });
    }
}

loadTasks();
distributeWork();

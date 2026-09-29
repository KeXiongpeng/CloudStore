export function hashFileInWorker(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/workers/sha256-worker.js');
    const id = crypto.randomUUID();

    worker.onmessage = (event) => {
      if (event.data.id !== id) return;
      worker.terminate();
      if (event.data.ok) resolve(event.data.hash);
      else reject(new Error(event.data.error));
    };

    worker.onerror = (error) => {
      worker.terminate();
      reject(error);
    };

    worker.postMessage({ id, file });
  });
}

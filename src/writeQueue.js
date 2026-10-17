// Every storage read-modify-write goes through this one chain, since GBF fires concurrent requests.
export function createWriteQueue(storage) {
  let writeQueue = Promise.resolve();
  return function enqueueUpdate(key, update) {
    writeQueue = writeQueue.then(
      () =>
        new Promise(resolve => {
          storage.get(key, data => {
            // A throw here would never resolve, stalling every later write; that one update is dropped instead.
            let value;
            try {
              value = update(data[key]);
            } catch (error) {
              console.error(`Gebe: update of ${key} failed`, error);
              resolve();
              return;
            }
            storage.set({ [key]: value }, resolve);
          });
        })
    );
    return writeQueue;
  };
}

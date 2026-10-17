// Every storage read-modify-write, and every remove, takes this one lock, since GBF fires concurrent requests.
// A Web Lock is shared by every page of the extension's origin: the panel and each open DevTools.
const LOCK = 'gebe-storage';

export function createWriteQueue(storage) {
  // Under the lock too, so an update that already read the key can't write it back after the remove.
  function enqueueRemove(keys) {
    return navigator.locks.request(LOCK, () => new Promise(resolve => storage.remove(keys, resolve)));
  }
  function enqueueUpdate(key, update) {
    return navigator.locks.request(
      LOCK,
      () =>
        new Promise(resolve => {
          storage.get(key, data => {
            // A throw here would never resolve, holding the lock forever; that one update is dropped instead.
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
  }
  return { enqueueUpdate, enqueueRemove };
}

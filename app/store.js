const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('batchline', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('workspace');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function transact(mode, operation) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', mode);
    const request = operation(transaction.objectStore('workspace'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const loadWorkspace = () => transact('readonly', store => store.get('current'));
export const saveWorkspace = state => transact('readwrite', store => store.put(state, 'current'));

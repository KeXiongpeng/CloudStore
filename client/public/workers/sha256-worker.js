async function digest(file) {
  const digestValue = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());

  return Array.from(new Uint8Array(digestValue))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

self.onmessage = async (event) => {
  try {
    const hash = await digest(event.data.file);
    self.postMessage({ ok: true, id: event.data.id, hash });
  } catch (error) {
    self.postMessage({ ok: false, id: event.data.id, error: error.message });
  }
};

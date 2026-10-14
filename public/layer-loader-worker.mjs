self.onmessage = async (event) => {
  const { id, file } = event.data ?? {};
  try {
    const res = await fetch(`/data/${file}`, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for /data/${file}`);
    const data = await res.json();
    self.postMessage({ id, ok: true, data });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error && error.message ? error.message : error) });
  }
};

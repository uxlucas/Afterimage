export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.versions) || !manifest.versions.length) {
    throw new Error('Version history is missing or has an unsupported format.');
  }
  let previous = Infinity;
  for (const version of manifest.versions) {
    const number = Number(version?.id?.slice(1));
    if (!/^v[1-9]\d*$/.test(version?.id) || !Number.isSafeInteger(number) || number >= previous ||
        version.file !== `versions/${version.id}/index.html` || version.label !== `Version ${number}` ||
        typeof version.name !== 'string' || !version.name.trim() ||
        !Array.isArray(version.notes) || version.notes.some(note => typeof note !== 'string') ||
        !/^[a-f0-9]{64}$/.test(version.sha256) ||
        (version.savedAt !== null && (typeof version.savedAt !== 'string' || !Number.isFinite(Date.parse(version.savedAt))))) {
      throw new Error('Version history contains an invalid entry.');
    }
    previous = number;
  }
  return manifest;
}

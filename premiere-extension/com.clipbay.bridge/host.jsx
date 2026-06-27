// Runs inside Premiere Pro (ExtendScript). Opens a file in the Source Monitor.
function openInSource(p) {
  try {
    app.sourceMonitor.openFilePath(p);
    return 'ok';
  } catch (e) {
    return 'err:' + e.toString();
  }
}

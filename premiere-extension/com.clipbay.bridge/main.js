// CEP panel: runs a tiny localhost HTTP server. ClipBay POSTs a file path here,
// and we ask Premiere (via ExtendScript) to open it in the Source Monitor.
(function () {
  var statusEl = document.getElementById('status');
  var PORT = 7878;

  function setStatus(msg, cls) {
    statusEl.textContent = msg;
    statusEl.className = cls || '';
  }

  function evalES(script) {
    try { window.__adobe_cep__.evalScript(script, function () {}); } catch (e) {}
  }

  var http = null;
  try { http = (window.cep_node ? window.cep_node.require : require)('http'); } catch (e) {}
  if (!http) { setStatus('Fehler: Node.js im Panel nicht verfügbar.', 'err'); return; }

  var server = http.createServer(function (req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'POST' && req.url === '/open') {
      var body = '';
      req.on('data', function (d) { body += d; });
      req.on('end', function () {
        var p = '';
        try { p = (JSON.parse(body) || {}).path || ''; } catch (e) {}
        if (p) {
          evalES('openInSource(' + JSON.stringify(p) + ')');
          setStatus('Geöffnet: ' + p, 'ok');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    } else if (req.url === '/ping') {
      res.writeHead(200); res.end('clipbay-bridge');
    } else {
      res.writeHead(404); res.end();
    }
  });

  server.on('error', function (e) {
    setStatus('Konnte Port ' + PORT + ' nicht öffnen (' + e.message + '). Läuft die Bridge schon?', 'err');
  });
  server.listen(PORT, '127.0.0.1', function () {
    setStatus('Verbunden · hört auf 127.0.0.1:' + PORT, 'ok');
  });
})();

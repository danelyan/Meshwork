// Точка входа по контракту (contract.md): верните обработчик запросов или приложение Express.
export function createApp() {
  return (req, res) => {
    res.writeHead(501, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_implemented' }));
  };
}

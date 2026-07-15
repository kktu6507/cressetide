---
id: 01-js-missing-return
lang: JavaScript
expected: hit
defect: "Missing `return` after the empty-items early response: execution falls through, so on an empty list the handler responds twice (204 then 200 with an empty body) — a double terminal write."
---

Intent: `handleList(items, res)` must send an empty `204` response and STOP when `items` is empty; otherwise render the rows and send `200` exactly once. Exactly one response per call.

```js
function handleList(items, res) {
  if (!items.length) {
    res.status(204).end();
  }
  const rows = items.map(renderRow);
  res.status(200).send(rows.join("\n"));
}
```

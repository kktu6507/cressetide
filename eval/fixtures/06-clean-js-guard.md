---
id: 06-clean-js-guard
lang: JavaScript
expected: clean
defect: "none — this is a CORRECT control. The early-return guard is present, so there is exactly one response per call. A blocker/major raised here is a FALSE POSITIVE (precision regression). Minor style notes are acceptable; a confident correctness blocker/major is not."
---

Intent: `handleList(items, res)` must send an empty `204` and STOP when `items` is empty; otherwise render rows and send `200` exactly once.

```js
function handleList(items, res) {
  if (!items.length) {
    res.status(204).end();
    return;
  }
  const rows = items.map(renderRow);
  res.status(200).send(rows.join("\n"));
}
```

---
id: 05-js-foreach-await
lang: JavaScript
expected: hit
defect: "`Array.prototype.forEach` does not await its async callback, so `saveAll` returns before any `save` settles and rejections are unhandled — the awaits inside forEach are ineffective. Use a `for...of` loop with await, or `await Promise.all(items.map(save))`."
---

Intent: `saveAll(items)` persists every item and resolves only AFTER all saves complete; if any save rejects, `saveAll` must reject.

```js
async function saveAll(items) {
  items.forEach(async (item) => {
    await save(item);
  });
  return "done";
}
```

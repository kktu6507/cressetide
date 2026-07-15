---
id: 04-py-mutable-default
lang: Python
expected: hit
defect: "Mutable default argument: `seen={}` (and `out=[]`) are evaluated once at def time and shared across calls, so dedup state leaks between independent calls — the second call sees the first call's `seen`. Defaults should be None and created inside."
---

Intent: `dedupe(items, seen={})` returns a new list of `items` with duplicates removed, order preserved. Each call is independent — calling it twice on different inputs must not share state.

```python
def dedupe(items, seen={}, out=[]):
    for it in items:
        if it not in seen:
            seen[it] = True
            out.append(it)
    return out
```

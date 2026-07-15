---
id: 07-clean-py-bounds
lang: Python
expected: clean
defect: "none — this is a CORRECT control. The pairwise scan stops at `len(a) - 1`, so `a[i + 1]` is always in bounds, and the empty/one-element cases are handled. A blocker/major raised here is a FALSE POSITIVE (precision regression). Minor notes are acceptable."
---

Intent: `max_adjacent_sum(a)` returns the maximum sum of any two ADJACENT elements; for a list with fewer than two elements it returns `None`.

```python
def max_adjacent_sum(a):
    if len(a) < 2:
        return None
    best = a[0] + a[1]
    for i in range(len(a) - 1):
        s = a[i] + a[i + 1]
        if s > best:
            best = s
    return best
```

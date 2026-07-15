---
id: 02-py-off-by-one
lang: Python
expected: hit
defect: "Off-by-one: the loop runs `i` to `len(a)-1` and reads `a[i+1]`, so on the last iteration it indexes `a[len(a)]` → IndexError. The pairwise scan should stop at `len(a)-1`."
---

Intent: `max_adjacent_sum(a)` returns the maximum sum of any two ADJACENT elements in a non-empty list `a` (i.e. max of `a[i] + a[i+1]`).

```python
def max_adjacent_sum(a):
    best = float("-inf")
    for i in range(len(a)):
        s = a[i] + a[i + 1]
        if s > best:
            best = s
    return best
```

---
id: 03-go-nil-before-check
lang: Go
expected: hit
defect: "The error is dereferenced before the nil check: `resp.StatusCode` is read while `resp` can be nil when `err != nil` (http.Get returns a nil *Response on error), causing a nil-pointer panic. The status read must come after the `if err != nil` guard."
---

Intent: `isUp(url)` returns true iff a GET to `url` succeeds with HTTP 200. A transport error must return false, not panic.

```go
func isUp(url string) bool {
	resp, err := http.Get(url)
	ok := resp.StatusCode == 200
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return ok
}
```

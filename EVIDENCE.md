# Cressetide evidence

Cressetide 0.1.0 的可重現證據由本 repository 自身產生：

- `npm run validate` 驗證 plugin 結構、Cressetide identity、Map、agent/skill/hook inventory、release 契約、`.ctide/` 邊界與 UTF-8 文字完整性。
- `npm test -- --test-reporter=dot` 執行 hooks、Doctor、publisher、validator、workflow contracts 與其他功能測試。
- `npm run eval` 執行版本控制內的 deterministic evaluation cases。
- `npx --yes @anthropic-ai/claude-code@2.1.207 plugin validate --strict ./cressetide` 驗證 nested plugin（marketplace 驗證由獨立的 `kktu6507/plugins` repo 負責）。
- `.github/workflows/release.yml` 以既有 immutable tag 為輸入，分離 validate、publish、attest 權限；publisher 產生 deterministic archive、SHA-256 checksum，並拒絕缺少、重複或額外的 release asset。

以上命令的實際執行結果必須由當次變更的 verification report 或 CI run 記錄；本檔不以靜態敘述取代執行證據。

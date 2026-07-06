# Karkoon — Speak your accounts

Voice-first double-entry accounting for Indian small businesses (Tally Prime groups, P&L, Balance Sheet, compliance alerts, Tally XML export).

## Update an existing repo
Repo → Add file → Upload files → drag ALL these files in → Commit. Same-named files are replaced; workflows are unchanged, so the APK build runs automatically after commit.

## Fresh setup
1. New public repo → upload all files (file picker works — everything is at root).
2. Rename `build-apk.yml` to `.github/workflows/build-apk.yml` (edit → add path in filename box) — this triggers the APK build.
3. Optional web version: rename `deploy.yml` to `.github/workflows/deploy.yml`, then Settings → Pages → Source: GitHub Actions.
4. Actions tab → green run → Artifacts → download APK.

## What's inside
- Voucher entry & ledger creation logic per approved spec (follow-up questions, fuzzy ledger match, Tally group mapping)
- Compliance alerts under entries (Income Tax ITA 2025, TDS S.393, GST, Karnataka PT)
- Bank details asked at first start (use your exact Tally ledger names)
- Day Book editing & deletion; ledger alteration (rename/regroup/opening)
- Tally Prime ready XML export (imports into the open company; KK- voucher numbers)


## New in this release
- Hinglish/Kannada voice commands (sharma ko 500 diye / kiraya diya / maal becha / se..mile / udhaar)
- GST on Sales & Purchase vouchers: 5%/18% chips, auto CGST+SGST or IGST split under Duties & Taxes
- Period filters on P&L (from-to) and Balance Sheet / Trial Balance (as-on)
- Outstanding report (receivables/payables, ageing, WhatsApp reminders) & Audit trail
- Multi-company books (Settings -> Company), PIN app lock, Backup & Restore (JSON)
- Day Book: search + type filters; voice read-back of entries; UNDO after save; Manual journal entry
- WhatsApp invoice share on Sales vouchers; Day Book CSV (Excel) export; Import Tally masters XML
- privacy.html (for the Play listing) and build-release.yml (signed .aab via GitHub secrets)

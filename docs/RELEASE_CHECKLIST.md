# Version 1.0.1 release checklist

## Completed in this package

- [x] Production name and semantic version
- [x] Manifest V3 with least-privilege permissions
- [x] 16, 32, 48, and 128 px extension icons
- [x] Branded popup and management page
- [x] Prototype-facing interface and console wording removed
- [x] Privacy policy drafted
- [x] Chrome Web Store copy and permission justifications drafted
- [x] Security review documented
- [x] Automated configuration, storage, account-scope, and Quick Solo tests
- [x] Production package excludes tests, source artwork, and internal documentation
- [x] Prototype calendar-name migration and personal fixtures removed from production

## Manual regression before wider distribution

- [ ] Create, rename, colour, reorder, collapse, and delete groups
- [ ] Assign, move, and ungroup calendars from both native sections
- [ ] Test individual and group visibility controls
- [ ] Solo a group, switch Solo groups, and restore the exact prior state
- [ ] Build and apply a Quick Solo selection, change it, refresh, and restore
- [ ] Run All with both collapsed and expanded native sections
- [ ] Scroll during ordinary sidebar use and confirm there is no jumping
- [ ] Confirm bulk commands protect sidebar scrolling until completion
- [ ] Test `/u/0` and `/u/1` independently
- [ ] Test narrow/wide sidebars, browser zoom, light mode, and dark mode
- [ ] Export, import, and reset configuration
- [ ] Confirm no event-editor colours appear as calendars

## Required only for Chrome Web Store submission

- [ ] Add a developer support email or support URL
- [ ] Publish the privacy policy at a public URL
- [ ] Capture privacy-safe store screenshots
- [ ] Complete the store privacy questionnaire using `STORE_LISTING.md`
- [ ] Upload the production ZIP and submit for review

# Technical audit — October 26, 2026

Verified against the repository and the live site. Historical reports were not in this repo or in the connected Drive search.

## Hosting

| Item | Verified state |
|---|---|
| Production URL | https://www.americanstandardbusinesssolutions.com/ |
| Host | GitHub Pages, `server: GitHub.com`, HTTPS enforced |
| Pages source | Branch `main`, path `/` |
| Custom domain | `www.americanstandardbusinesssolutions.com` and apex, certificate approved |
| Workflows before this branch | None |
| Open pull requests / issues | None |
| `development/asbs-consultation-poc` | Not on `origin`. `git ls-remote` shows only `main`. |
| Commit `6502679adeb8793d29109c94f8a4435740ad5112` | Not in this repository |
| Uncommitted local work on arrival | None. `main` matched `origin/main`. |
| Staging deployment | None. Publishing this branch through the existing Pages site would replace production. |

## Production site at audit

Plain HTML, Tailwind from a CDN, and Lucide from a CDN. Quote requests post to FormSubmit for `americanstandardsolutions@gmail.com`. A public Stripe Payment Link pays an existing invoice. Phone (281) 954-5167 and `info@americanstandardbusinesssolutions.com` are on the page.

Published facts used as the content baseline: Katy / Greater Houston facility services, nationwide supply shipping, Texas CMBL, Texas Veteran-Owned Business (Texas Veterans Commission verified), UEI MXEQNQLXY1G9, CAGE 20KS7, NAICS/NIGP list, and the existing leadership bio for Eric LeBeaux. Secondary pages used an older red/navy stylesheet and a broken `#pay` anchor.

## Integrations visible to this session

| Integration | State |
|---|---|
| Google Calendar | The session can read the primary calendar. Its time zone is America/Chicago. The website process has no OAuth client credentials, so it cannot use that session. No events were created or changed. |
| Google Drive | No folder named “American Standard Business Solutions,” and no copies of the named completion reports or implementation brief. |
| Stripe | Existing public invoice link remains. Package checkout was not added. Stripe was not queried. |
| Analytics | No measurement ID in the repository. |
| Search Console | No verification token in the repository. |

Private research in Drive was not copied onto the public site. Unpublished contract performance, personal financial records, and clearance details are not website content.

## Status matrix at the start of this branch

| Feature | Status then |
|---|---|
| Branded homepage, supplies, facility services, capability statement | Complete on production |
| Quote form via FormSubmit | Complete on production |
| Invoice payment link | Complete on production; not a package checkout |
| About, services, packages, intake, vendor registration, scheduling | Not started in this repository |
| CRM, dashboard, weekly report | Not started |
| Google Calendar booking | Not started |
| Tests and CI | Not started |
| Staging URL separate from production | Not started |

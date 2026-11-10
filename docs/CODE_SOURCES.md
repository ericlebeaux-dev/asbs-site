# NAICS and NIGP sources

Retrieved November 10, 2026. This is a source note for the website, not a legal opinion.

## NAICS — shipped in full

The intake form and the public reference use the official 2022 six-digit NAICS codes and titles.

- Publisher: U.S. Census Bureau
- File: `2-6 digit_2022_Codes.xlsx`
- URL: https://www.census.gov/naics/2022NAICS/2-6%20digit_2022_Codes.xlsx
- Census NAICS site: https://www.census.gov/naics/?year=2022
- Workbook last-modified metadata: 2021-11-16, last modified by a Census Bureau ESMD account
- Retrieved: 2026-11-10
- Workbook SHA-256: `be12ba41002803359f49181c9bf33a03fbd08578f4f4a4c0bbad7aadaaea0316`
- License: U.S. government work, public domain (17 U.S.C. § 105). No fee and no extra terms were required to copy the code and title columns.

The site file is `assets/codes/naics-2022.json`. It contains 1,012 six-digit codes and the 20 sector headers from that workbook (including `31-33`, `44-45`, and `48-49`). The page loads this file only when the reference section is near the screen, or when someone focuses the NAICS search on the intake form. `scripts/build_naics.py` can rebuild the JSON from the Census URL. It does not download NIGP.

The server checks every submitted NAICS code against this file and stores the official title, even if the browser sent a different title.

## NIGP — not copied

The NIGP Commodity/Services Code is not public domain.

Reviewed on November 10, 2026:

- NIGP describes the code as commercially available by annual subscription, licensed and supported by NIGP Code & Consulting, powered by Periscope Holdings, Inc. https://www.nigp.org/our-profession/nigp-code
- Periscope’s “NIGP Code Sublicense Subscription Agreement 2026” says the Code is copyrighted, and that a subscriber may not copy, publish, or transfer the Code without later written authorization. It also restricts use of less than the full code and requires a copyright notice. https://www.periscopeholdings.com/assets/uploads/misc/NIGP_Code_License_Agreement_250626_134521.pdf (SHA-256 `ab5ec1c8ac0b1640d91b430cb19428dadb98a6ce83ae3fc6b6bd3a430c250f8d`, retrieved the same day)
- The Texas Comptroller publishes an NIGP commodity book for bidders, vendors, and state agency personnel, and a search at https://commbook.app.cpa.state.tx.us/. The Comptroller’s CMBL FAQ says: “The NIGP Commodity Book is licensed and should not be printed.” https://comptroller.texas.gov/purchasing/vendor/cmbl/faq.php
- The Comptroller’s NIGP page says state agencies and Texas SmartBuy members use the Living Code through the annual site license obtained by the Statewide Procurement Division. https://comptroller.texas.gov/purchasing/nigp/

That public Texas book is the state’s licensed copy for people using Texas purchasing. It does not say a third party may republish the class list or the class-item list. The 3-digit class titles are part of the same copyrighted code, and the subscription terms restrict copying less than the full code. Redistribution was not clearly permitted, so this site does not ship class titles, item titles, or a code catalog.

What the site does instead:

- Visitors browse NAICS here.
- For NIGP, they open the Texas Comptroller lookup, then type a 3-digit class or a 5-digit class-item (stored as `123-45`). An optional note is stored only if the visitor typed it. The site does not supply or check an official NIGP description.
- The page states that NIGP descriptions are not reproduced and links to the Comptroller search.

No paid API and no NIGP subscription were added.

## How an intake stores the codes

The intake form posts JSON to `POST /api/intake` on the ASBS server. That is the record the dashboard reads. There is no Jotform and no separate form backend.

The form fields are the existing names:

| Field | Element | Stored on the lead |
| --- | --- | --- |
| `naics` | Visible textarea, not `type="hidden"` | `lead.intake.naics` |
| `nigp` | Visible textarea, not `type="hidden"` | `lead.intake.nigp` |

HubSpot’s tracking script is already on the public pages and skips hidden inputs, so these values stay in visible named fields. This change does not edit the HubSpot account.

Canonical stored text is one entry per line.

NAICS, official title from the Census file:

```
541511 — Custom Computer Programming Services
541512 — Computer Systems Design Services
```

NIGP, code only, or code plus a note the visitor typed:

```
123-45 — note the visitor typed
910
```

The server also accepts the same entries separated by semicolons, or by a comma when the next entry starts with a code. Titles contain commas, so a comma is not a separator unless a code follows it. Up to 20 codes of each kind. Empty is allowed. The consultation is still free. Nothing on this flow adds a price.

When Gmail is configured, the intake notice includes a `NAICS:` line and a `NIGP:` line. The lines are the same text with semicolons instead of line breaks. Tests use a fake mailer and do not send to a real inbox.

### If HubSpot should also keep the codes

Do this in the HubSpot dashboard only if the contact record should store them. It was not done here.

1. In HubSpot, add two contact properties if they do not already exist.
2. Internal names: `naics` and `nigp`. Labels can be “NAICS codes” and “NIGP codes”.
3. Field type: multi-line text.
4. Do not make them hidden form fields. The site already sends the visible textareas with those names.
5. NAICS lines are `code — Census title`. NIGP lines are `code` or `code — note the visitor typed`.

HubSpot’s collected-forms feature can store a submission field even when no contact property exists. The ASBS server record is the one the dashboard shows either way.

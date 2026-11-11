# Document upload deploy

Free tiers only. This does not change GitHub Pages pages, ads, analytics, or the intake form. The phone number stays (281) 954-5167. No street address is added.

## What goes live

The upload page is served by the Render API at `/poc/onboarding`. It is not a GitHub Pages file. It stays off until `DOCS_ENABLED=1` and the storage settings are present.

## Merge

1. Merge the document-upload pull request into `main` with a merge commit.
2. Leave GitHub Pages on `main`. The static site rebuild should not change public page copy.

## Render

Service: `asbs-staging` (free plan, Oregon). This is the API the live site already calls. Do not create another service and do not change the plan.

Before this change, that service deploys branch `cursor/docs-upload-poc-b99f`. `render.yaml` now sets branch `main` and leaves `autoDeployTrigger: off`.

1. In Render, set the service branch to `main`. Leave auto-deploy off.
2. Set the environment variables below. Do not commit the secrets.
3. Trigger one manual deploy of `main`.

## Environment

| Variable | Production value |
| --- | --- |
| DOCS_ENABLED | `1` |
| DOCS_S3_ENDPOINT | `https://s3.us-west-004.backblazeb2.com` |
| DOCS_S3_REGION | `us-west-004` |
| DOCS_S3_BUCKET | `asbs-intake-docs` |
| DOCS_S3_KEY_ID | Application key id for that bucket only. Not committed. |
| DOCS_S3_SECRET | Application key secret. Not committed. |
| DOCS_MAX_BYTES | `10485760` |
| DOCUMENSO_API_TOKEN | Existing Documenso Free personal token. Not committed. |
| DOCUMENSO_TEMPLATE_ID | `envelope_cksvtwubbmfinvsa` |
| DOCUMENSO_BASE_URL | `https://app.documenso.com/api/v2` |
| DOCUMENSO_DELETE_COMPLETED | `1` only if a completed envelope should be deleted after the signed file is stored. The free plan often refuses that delete. |

`asbs-intake-docs` is a private bucket on the existing free Backblaze account, same region as `asbs-intake-docs-staging`. Leave its CORS at the default of no origins. SSE-B2 stays on. The current staging key is limited to `asbs-intake-docs-staging` and cannot create the production bucket. The Documenso template is the existing free-plan sample. Its legacy numeric id is `25481`.

## Rollback

1. In Render, set `DOCS_ENABLED` empty and deploy again. `/poc/onboarding` returns 404 and intake is unchanged.
2. Or set the service branch back to `cursor/docs-upload-poc-b99f` and manually deploy commit `47e8e11387ed526e405b864023efd4335a3f0193`.
3. Leave GitHub Pages on `main`. Do not revert the static site unless a Pages file changed.

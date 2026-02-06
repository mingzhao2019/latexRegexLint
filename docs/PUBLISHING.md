# Publishing to VS Code Marketplace

This document records the exact workflow we used to publish this extension. It intentionally omits secrets and tokens.

## 1) Create Publisher (Marketplace)
- Go to the Marketplace site and sign in.
- Create a publisher named `mingzhao2019`.
- Make sure you are in the **correct directory/tenant** for the Outlook (Microsoft) account.
- The publisher is bound to your Microsoft account identity (user ID shown in the publisher profile).

## 2) Create Azure DevOps PAT (required)
- Sign in to **Azure DevOps** with the **same Microsoft account** used for the publisher.
- Confirm you are in the **correct directory/tenant** (switch in the avatar menu if needed).
- Create a **Personal Access Token** with scope:
  - **Marketplace → Publish**
- PATs are time-limited. When expired, create a new one and update GitHub Secrets.

## 3) Local validation (optional but recommended)
```bash
npm i -g @vscode/vsce
vsce login mingzhao2019
```
This validates that your PAT can publish.

## 4) GitHub Actions secret
- In GitHub repo: Settings → Secrets and variables → Actions
- Add secret:
  - Name: `VSCE_PAT`
  - Value: your PAT

## 5) Release process (automated)
- Update `package.json` version.
- Tag and push:
```bash
git tag vX.Y.Z
git push --tags
```
- The workflow `.github/workflows/release.yml` will:
  1) build VSIX
  2) publish to Marketplace using `VSCE_PAT`
  3) create GitHub Release + upload VSIX

## Common Pitfall (observed)
- If you are in the **wrong Azure DevOps directory/tenant**, the PAT will authenticate but fail to publish.
- Always verify the directory matches the Marketplace publisher account.

## References
- Publishing guide: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- CI guide: https://code.visualstudio.com/api/working-with-extensions/continuous-integration

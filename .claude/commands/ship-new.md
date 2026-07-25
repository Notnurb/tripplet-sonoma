---
description: Tag a new version and create matching GitHub + GitLab releases
---

Create a new release of this project on both remotes, mirroring what was done manually to create v3.3.0.

Steps:
1. Confirm `gh` and `glab` are installed (`which gh glab`); if either is missing, `brew install gh glab`.
2. Confirm both are authenticated (`gh auth status`, `glab auth status`). If not, pull the cached credentials from the macOS keychain and log in:
   - GitHub: `git credential-osxkeychain get <<< $'protocol=https\nhost=github.com'` for the password, then `gh auth login --with-token`.
   - GitLab: same pattern with `host=gitlab.com`, then `glab auth login --hostname gitlab.com --token <token>`.
3. Ask the user (via AskUserQuestion) what version tag to use if not given as an argument (e.g. `v3.4.0`), and what the release title should be — offer the changelog's current top version (`src/app/changelog/page.tsx`) as a suggested default.
4. Make sure the working tree is clean and `main` is up to date (`git status`, `git pull`).
5. Create the tag: `git tag <tag>`.
6. Push the tag to both remotes in one shot: `git push origin <tag>` — `origin` is already configured to push to both gitlab.com/alex3.brunton/tripplet-sonoma and github.com/Notnurb/tripplet-sonoma (see `git remote -v`; if it's only pushing to GitLab, re-add the GitHub push URL with `git remote set-url --add --push origin https://github.com/Notnurb/tripplet-sonoma.git`).
7. Create the GitHub release with auto-generated notes:
   `gh release create <tag> --repo Notnurb/tripplet-sonoma --title "<tag> — <name>" --generate-notes`
8. Reuse those notes for GitLab (GitLab's CLI has no auto-generate-from-commits option), then create the GitLab release:
   ```
   gh release view <tag> --repo Notnurb/tripplet-sonoma --json body -q .body > /tmp/release_notes.md
   glab release create <tag> --repo alex3.brunton/tripplet-sonoma --name "<tag> — <name>" --notes-file /tmp/release_notes.md
   ```
9. Report both release URLs back to the user.

Do not force-push or overwrite an existing tag/release without explicit confirmation from the user.

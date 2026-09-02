# Firebase Hosting deployment safety

Firebase Hosting must publish only the generated `dist/hosting` directory. The
repository root is application source and is never a Hosting publish directory.

## Safe workflow

1. Review every runtime path in `hosting-runtime-files.json`. Adding a file is a
   publication decision; the build does not infer or recursively copy new files.
2. Run `npm run build:hosting`. The command removes only the exact
   `dist/hosting` directory, validates the allowlist and local dependencies, and
   recreates the directory from the reviewed source files.
3. Review the generated inventory and run `npm run test:hosting:safety` plus the
   repository test gates.
4. Confirm the proposed website content has separate owner approval. Passing the
   safety tests proves file-boundary controls only; it does not approve legal,
   billing, marketing or other content.
5. Deploy Hosting only with:

   `firebase deploy --only hosting:main --project simple-books-office`

The Hosting target has a `predeploy` hook that reruns the build. A failed build
removes generated output and blocks deployment, so stale output is not used.

## Publication exclusions

The build rejects Git/local state, dot-directories, Firebase reserved paths,
backend source, tests, scripts, logs, reports, documentation, development
configuration, and credential/environment filenames. Firebase creates
`/__/firebase/init.js` and `/__/firebase/init.json`; they must not be copied.

`privacy.html`, `terms.html`, and `assets/legal.css` are excluded until owner and
legal review is complete. Any allowlisted source file linking to those excluded
pages blocks the build. A referenced local runtime file not already in the
reviewed allowlist also blocks the build.

## Release safety

The verified containment release is Hosting version `ba9ff337be8b742e`. Do not
roll back to the earlier exposed release (`d67d811d7101aef8`) because it included
repository history and development artifacts. If rollback is needed, select a
known-safe release and verify its complete file manifest first.

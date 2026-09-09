# Route 2 P0 Role Implementation Status

## Implemented on `main`

- Added explicit `resident` / `family` role state with local persistence.
- Added visible role switcher to the Route 2 web shell.
- Resident surface now exposes `我的家` and `找东西`.
- Family surface now exposes `家庭状态`, `风险证据`, and `影响路线`.
- Family action plan and rescan remain available only in the family workflow.
- The route view is now labelled as an explanation of risk impact rather than a prediction of actual elder behavior.
- Added P0 role acceptance documentation and automated role-surface contract tests.

## Evidence boundary preserved

- Demo and real scene modes remain explicit.
- Unlocalized real objects/routes remain unavailable rather than being fabricated.
- Home Twin remains shared infrastructure underneath both roles.

## Validation status

The repository CI workflow for Route 2 is configured to run Web tests, Python compilation/unit tests, TypeScript typecheck and production build. A local execution was not claimed here because the current tool environment could not reliably clone/execute the repository from GitHub.

## Known next step

A browser-level black-box test should be added after the role UI stabilizes, covering role switching, keyboard/accessibility behavior, and the absence of cross-role primary actions.

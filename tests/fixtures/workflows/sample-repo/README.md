# Workflow sample repo

Fixture project used by Visual DAG Workflows tests. It has no source code of its
own — only an `orca.yaml` that allowlists `github/spec-kit` as a workflow source
and an empty `orca-workflows/` directory that tests populate with
`*.workflow.yaml` files as needed.

Copy it into a temp git repo with `tests/fixtures/workflows/create-sample-repo.ts`
rather than using this checked-in copy directly.

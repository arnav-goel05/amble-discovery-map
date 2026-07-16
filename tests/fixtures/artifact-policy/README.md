# Artifact policy fixtures

The artifact-policy verifier creates its cases in a temporary Git repository. Fixture names
represent these classes:

- approved source, registry, snapshot manifest, and required POI asset: tracked;
- raw download, pipeline run, local index, cache, lock, database sidecar, screenshot, and
  routine report: ignored;
- secret or populated environment file: ignored and rejected if tracked.

No runtime output from a developer machine belongs in this directory.

# Humans read here

## Problem
<!-- What issue, bug, or missing capability does this PR address? Frame the problem clearly for human context. -->

{{problem}}

## Solution
<!-- Summarize the technical design and changes made to solve the problem. High-level focus, avoid detailing every single file. -->

{{solution}}

# Agents read here

```yaml
pr_type: {{pr_type}}
scope: {{scope}}

breaking_changes:
  has_breaking_changes: {{has_breaking_changes}}
  description: {{breaking_changes_description}}

modified_components: {{modified_components}}

environment_variables:
  added: {{environment_variables_added}}
  modified: {{environment_variables_modified}}
  removed: {{environment_variables_removed}}

agent_instructions:
  review_focus: {{review_focus}}
  dependencies_changed: {{dependencies_changed}}
  db_migration_required: {{db_migration_required}}
  post_merge_actions: {{post_merge_actions}}
```

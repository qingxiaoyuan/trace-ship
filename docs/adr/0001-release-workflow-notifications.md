# 0001 - Release Workflow and Notifications

**Status:** superseded by [0002 - 内置打包替代 Jenkins](./0002-internal-package-workflow.md) for build/package lifecycle
**Date:** 2026-06-24
**Spec:** none - needs linking
**Deciders:** project maintainers

## Context

> 2026-07-02 update: Jenkins 构建生命周期已由 ADR-0002 的系统内置打包任务替代。本文仍保留工作流与通知拆分的历史决策背景，不再作为发布后打包状态机依据。

Release records now need an approval workflow before build, Jenkins build status integration, optional post-build approval progression, automatic tag publishing, operation logs, and in-app notifications.

The codebase already separates Django apps by business area, so workflow orchestration and user notifications are modeled as separate apps instead of being embedded directly in release views.

## Decision

Add a `workflow` app for reusable workflow definitions, instances, and tasks. Release approval creates a workflow instance and stores a reference on the release record.

Add a `notification` app for user-facing in-app messages. Workflow tasks, build results, and release completion create notifications through `NotificationService`.

Release lifecycle remains owned by `ReleaseService`:

- Draft releases submit into workflow approval.
- Completed pre-build approval moves the release to building and triggers Jenkins.
- Failed builds reject the release.
- Successful builds move the release to auditing.
- If the workflow still has post-build approval nodes, the workflow advances.
- If no post-build approval is running, the release pushes the tag and becomes released.

## Consequences

Release status transitions are centralized in service methods and can be tested without going through views.

Workflow and notification APIs can be reused by frontend screens and other business domains later.

The lifecycle now depends on consistent contracts between workflow status, release status, Jenkins build status, and notification models. Future changes should update this ADR or supersede it when the state machine changes.

## Alternatives Considered

Embedding approval fields directly on `ReleaseRecord` would be simpler for one release flow, but would make later approval variants harder to reuse and would mix workflow concerns with release persistence.

Sending notifications inline from views was rejected because status transitions also happen from service and Jenkins polling paths.

# Select tool and generic handles

Goal: a Select tool that shows every handle (path/river points, cave points, pond seeds) and lets any be selected,
moved, scaled and deleted, through one handle interface that does not depend on the feature type.

- `tools/handles.ts`: `HandleRef` (`{kind, id, point}`), and pure functions over `Features` that dispatch on kind:
  `listHandles`, `handleAxes`, `moveHandle`, `removeHandle`, `scaleHandle`. Each clamps like the type's own tool.
- `tools/selectInput.ts`: `SelectInput` (pure, like the other inputs): hover/pick by ray, free drag in the handle's
  horizontal plane, axis-arrow drag, Delete removes the point, Escape deselects, click on nothing deselects.
- `viewport/SelectRig.tsx`: draws all handles and the gizmo, feeds pointer events to `SelectInput`, keeps the store
  selection in sync both ways.
- Store: `ToolId` gains `select`; `FeaturePanel` shows the panel for whatever is selected; `S` toggles the tool.
- Out of scope: migrating the Path/River/Cave/Water tools onto the generic move; multi-selection.
- Manual checks: look and feel of handles and gizmo, dragging at frame rate.

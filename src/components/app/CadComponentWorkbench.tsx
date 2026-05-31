import type { ChangeEvent } from "react"
import { ALIGNMENT_OPTIONS, NORMAL_OPTIONS } from "../../lib/cad"
import { LoadingViewport } from "../LoadingViewport"
import { SceneCanvas } from "../SceneCanvas"
import {
  CheckboxField,
  NumberField,
  Section,
  SelectField,
  Vector3Field,
} from "../editor/Fields"
import type { UseCadComponentEditorResult } from "../../hooks/useCadComponentEditor"
import type { UseCadViewerResult } from "../../hooks/useCadViewer"
import type { Alignment, AxisDirection } from "../../types"

interface CadComponentWorkbenchProps {
  editor: UseCadComponentEditorResult
  viewer: UseCadViewerResult
}

export function CadComponentWorkbench({
  editor,
  viewer,
}: CadComponentWorkbenchProps) {
  const handleWorkspaceFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    editor.setUploadedModelFile(file)
  }

  return (
    <main className="app-shell" {...editor.dropTargetProps}>
      {editor.isDragActive ? (
        <div className="workspace-drop-overlay">
          <div className="workspace-drop-card">
            <strong>Drop to replace the current model</strong>
            <span>The current placement settings will stay in the editor.</span>
          </div>
        </div>
      ) : null}

      <div className="sidebar-frame">
        <aside className="sidebar">
          <div className="sidebar-scroll">
            <section className="hero-card">
              <div className="sidebar-toolbar">
                <div className="hero">
                  <p className="eyebrow">Controls</p>
                  <h1>`cad_component`</h1>
                </div>
              </div>

              <div className="summary-strip">
                <article
                  className={`summary-card compact status-${viewer.summary.statusClass}`}
                >
                  <span className="summary-label">Status</span>
                  <strong>{viewer.summary.statusLabel}</strong>
                  <p>{viewer.summary.statusMeta}</p>
                </article>
                <article className="summary-card compact source-card">
                  <span className="summary-label">Source</span>
                  <strong>{viewer.summary.sourceType}</strong>
                  <p title={viewer.summary.sourceValue}>
                    {viewer.summary.shortSourceValue}
                  </p>
                </article>
                <article className="summary-card compact board-card">
                  <span className="summary-label">Board</span>
                  <strong>{viewer.summary.boardLabel}</strong>
                  <p>{`Thickness ${editor.boardThickness.toFixed(2)} mm`}</p>
                </article>
              </div>

              <div className="actions hero-actions">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => editor.setMode("landing")}
                >
                  Load another model
                </button>
              </div>
            </section>

            <Section
              title="Component Model"
              description="Define the imported geometry origin and the board-facing normal used for placement."
            >
              <Vector3Field
                title="model_origin_position"
                labels={["x", "y", "z"]}
                values={[
                  editor.cad.model_origin_position.x,
                  editor.cad.model_origin_position.y,
                  editor.cad.model_origin_position.z,
                ]}
                onChange={(axis, value) =>
                  editor.updateVector({
                    key: "model_origin_position",
                    axis,
                    value,
                  })
                }
              />
              <SelectField<Alignment>
                label="model_origin_alignment"
                value={editor.cad.model_origin_alignment}
                options={ALIGNMENT_OPTIONS}
                onChange={(value) =>
                  editor.updateField("model_origin_alignment", value)
                }
              />
              <SelectField<AxisDirection>
                label="model_board_normal_direction"
                value={editor.cad.model_board_normal_direction}
                options={NORMAL_OPTIONS}
                onChange={(value) =>
                  editor.updateField("model_board_normal_direction", value)
                }
              />
            </Section>

            <Section
              title="Component Placement"
              description="Position the component in board space and control the anchor used for alignment."
            >
              <Vector3Field
                title="position"
                labels={["x", "y", "z"]}
                values={[
                  editor.cad.position.x,
                  editor.cad.position.y,
                  editor.cad.position.z,
                ]}
                onChange={(axis, value) =>
                  editor.updateVector({ key: "position", axis, value })
                }
              />
              <Vector3Field
                title="size"
                labels={["x", "y", "z"]}
                values={[
                  editor.cad.size.x,
                  editor.cad.size.y,
                  editor.cad.size.z,
                ]}
                onChange={(axis, value) => editor.updateSize({ axis, value })}
              />
              <SelectField<Alignment>
                label="anchor_alignment"
                value={editor.cad.anchor_alignment}
                options={ALIGNMENT_OPTIONS}
                onChange={(value) =>
                  editor.updateField("anchor_alignment", value)
                }
              />
            </Section>

            <Section
              title="Model Source"
              description="Switch between a remote asset URL and a local upload while keeping placement edits intact."
            >
              <label className="control-stack">
                <span>Model URL (.obj, .step, .stp, .gltf, .glb)</span>
                <input
                  type="text"
                  value={editor.cad.model_obj_url}
                  placeholder="https://example.com/component.glb"
                  onChange={(event) => editor.setModelUrl(event.target.value)}
                />
              </label>
              <label className="control-stack file-picker">
                <span>Local model file (.obj, .step, .stp, .gltf, .glb)</span>
                <input
                  type="file"
                  accept=".obj,.step,.stp,.gltf,.glb"
                  onChange={handleWorkspaceFileChange}
                />
              </label>
              {editor.localModelFile ? (
                <div className="inline-action-row">
                  <div className="file-chip">{editor.localModelFile.name}</div>
                  <button
                    type="button"
                    className="button-ghost"
                    onClick={editor.clearLocalModelFile}
                  >
                    Clear local file
                  </button>
                </div>
              ) : null}
            </Section>

            <details className="json-panel" open>
              <summary>Board Properties</summary>
              <div className="editor-grid details-grid">
                <NumberField
                  label="board_thickness"
                  value={editor.boardThickness}
                  onChange={editor.setBoardThickness}
                />
                <CheckboxField
                  label="show_board"
                  checked={editor.showBoard}
                  onChange={editor.setShowBoard}
                />
              </div>
            </details>

            <details className="json-panel">
              <summary>Circuit JSON</summary>
              <p className="json-help">
                Import by pasting JSON and clicking apply. The form controls
                stay authoritative for editing.
              </p>
              <label className="field">
                <span>Paste JSON</span>
                <textarea
                  className="import-textarea"
                  value={editor.importText}
                  onChange={(event) => editor.setImportText(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="button-primary"
                  onClick={editor.importJson}
                >
                  Apply pasted JSON
                </button>
              </div>
              {editor.importError ? (
                <div className="status-pill error">
                  JSON parse error: {editor.importError}
                </div>
              ) : null}
              <label className="field">
                <span>Generated `cad_component`</span>
                <textarea
                  className="json-output"
                  value={editor.generatedJson}
                  readOnly
                  spellCheck={false}
                />
              </label>
            </details>
          </div>
        </aside>
      </div>

      <section className="viewer-panel">
        {viewer.status === "loading" ? (
          <LoadingViewport message={viewer.message} />
        ) : (
          <SceneCanvas
            title={viewer.title}
            subtitle={viewer.subtitle}
            up={viewer.up}
            sceneBounds={viewer.sceneBounds}
            buildScene={viewer.buildScene}
          />
        )}
      </section>
    </main>
  )
}

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  ALIGNMENT_OPTIONS,
  NORMAL_OPTIONS,
  buildFallbackGeometry,
  computePlacement,
  detectModelFormat,
  getGeometryBounds,
  normalizeCadComponent,
  parseModelFromBuffer,
  parseModelFromUnknownBuffer,
} from "./lib/cad";
import {
  addDefaultLights,
  createCamera,
  createControls,
  createRenderer,
  fitRenderer,
  makeAxisBadges,
  makeAxesToBadgePositions,
  makeBoard,
  makeBoardNormalArrow,
  makeGrid,
  makeHoverMarker,
  type HoverTarget,
} from "./lib/scene";
import { SAMPLE_CAD_COMPONENT } from "./sampleCadComponent";
import type { Alignment, AxisDirection, CadComponentInput } from "./types";

type ModelSource =
  | { kind: "none" }
  | { kind: "url"; value: string }
  | { kind: "file"; file: File };

function parseInput(text: string): {
  value: CadComponentInput | null;
  error: string | null;
} {
  try {
    return { value: JSON.parse(text) as CadComponentInput, error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [delayMs, value]);

  return debouncedValue;
}

function getIdleMessage(source: ModelSource): string {
  if (source.kind === "none") {
    return "Using fallback box from size.";
  }
  const format = detectModelFormat(
    source.kind === "file" ? source.file.name : source.value,
  );
  if (!format) {
    return "Loading model and detecting format...";
  }
  return `Loading ${format.toUpperCase()} model...`;
}

function useCadGeometry(source: ModelSource) {
  const [state, setState] = useState<{
    geometry: THREE.BufferGeometry | null;
    status: "idle" | "loading" | "ready" | "fallback";
    message: string;
  }>({
    geometry: null,
    status: source.kind === "none" ? "fallback" : "loading",
    message: getIdleMessage(source),
  });

  useEffect(() => {
    let disposed = false;

    if (source.kind === "none") {
      setState({
        geometry: null,
        status: "fallback",
        message: "Using fallback box from size.",
      });
      return;
    }

    const sourceName = source.kind === "file" ? source.file.name : source.value;
    const format = detectModelFormat(sourceName);

    setState({
      geometry: null,
      status: "loading",
      message: format
        ? `Loading ${format.toUpperCase()} model...`
        : "Loading model and detecting format...",
    });

    const controller = new AbortController();
    const readSource = async () => {
      if (source.kind === "file") {
        return source.file.arrayBuffer();
      }
      const response = await fetch(source.value, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch model (${response.status})`);
      }
      return response.arrayBuffer();
    };

    readSource()
      .then(async (buffer) => {
        if (format) {
          return { geometry: await parseModelFromBuffer(buffer, format), format };
        }
        return parseModelFromUnknownBuffer(buffer);
      })
      .then(({ geometry, format: resolvedFormat }) => {
        if (disposed) {
          geometry.dispose();
          return;
        }
        setState({
          geometry,
          status: "ready",
          message:
            source.kind === "file"
              ? `${resolvedFormat.toUpperCase()} loaded from ${source.file.name}.`
              : `${resolvedFormat.toUpperCase()} loaded successfully.`,
        });
      })
      .catch((error: unknown) => {
        if (disposed || controller.signal.aborted) {
          return;
        }
        setState({
          geometry: null,
          status: "fallback",
          message:
            error instanceof Error
              ? `${error.message}. Falling back to size box.`
              : "Failed to load model. Falling back to size box.",
        });
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [source]);

  useEffect(
    () => () => {
      state.geometry?.dispose();
    },
    [state.geometry],
  );

  return state;
}

function SceneCanvas({
  title,
  subtitle,
  up,
  buildScene,
}: {
  title: string;
  subtitle: string;
  up: THREE.Vector3;
  buildScene: (
    scene: THREE.Scene,
  ) => { hoverTargets?: HoverTarget[]; overlayObjects?: THREE.Object3D[] } | void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const controlsRef = useRef<ReturnType<typeof createControls> | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const overlaySceneRef = useRef<THREE.Scene | null>(null);
  const hoverTargetsRef = useRef<HoverTarget[]>([]);
  const [projection, setProjection] = useState<"perspective" | "orthographic">(
    "orthographic",
  );
  const [viewPreset, setViewPreset] = useState<
    "side" | "front" | "top" | "corner"
  >("corner");
  const [hovered, setHovered] = useState<{
    x: number;
    y: number;
    lines: string[];
  } | null>(null);

  const disposeScene = (scene: THREE.Scene | null) => {
    if (!scene) {
      return;
    }
    scene.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        if (Array.isArray(object.material)) {
          for (const material of object.material) {
            material.dispose();
          }
        } else {
          object.material.dispose();
        }
      }
    });
    scene.clear();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const renderer = createRenderer(canvas);
    renderer.autoClear = false;
    const createActiveCamera = () => {
      const direction = (() => {
        switch (viewPreset) {
          case "top":
            return up.clone().normalize();
          case "front":
            return new THREE.Vector3(0, 1, 0);
          case "side":
            return new THREE.Vector3(1, 0, 0);
          case "corner":
          default:
            return new THREE.Vector3(1, 1, 1).normalize();
        }
      })();
      const distance = 90;

      if (projection === "orthographic") {
        const aspect = Math.max(canvas.clientWidth / Math.max(canvas.clientHeight, 1), 1);
        const frustum = 40;
        const camera = new THREE.OrthographicCamera(
          -frustum * aspect,
          frustum * aspect,
          frustum,
          -frustum,
          0.1,
          1000,
        );
        camera.up.copy(up);
        camera.position.copy(direction.multiplyScalar(distance));
        return camera;
      }

      const camera = createCamera(up);
      camera.position.copy(direction.multiplyScalar(distance));
      return camera;
    };

    const camera = createActiveCamera();
    const controls = createControls(camera, canvas);
    const scene = new THREE.Scene();
    const overlayScene = new THREE.Scene();
    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;
    sceneRef.current = scene;
    overlaySceneRef.current = overlayScene;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const resize = () => fitRenderer(renderer, camera, canvas);
    resize();

    const updateHover = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const intersections = raycaster.intersectObjects(
        hoverTargetsRef.current.map((target) => target.object),
        true,
      );

      if (intersections.length === 0) {
        setHovered(null);
        canvas.style.cursor = "default";
        return;
      }

      const hit = hoverTargetsRef.current.find((target) =>
        intersections.some(
          (intersection) =>
            intersection.object === target.object ||
            target.object.children.includes(intersection.object),
        ),
      );

      if (!hit) {
        setHovered(null);
        canvas.style.cursor = "default";
        return;
      }

      const projected = hit.position.clone().project(camera);
      setHovered({
        x: ((projected.x + 1) / 2) * rect.width,
        y: ((-projected.y + 1) / 2) * rect.height - 12,
        lines: hit.lines,
      });
      canvas.style.cursor = "pointer";
    };

    const onPointerMove = (event: PointerEvent) => {
      updateHover(event.clientX, event.clientY);
    };

    const onPointerLeave = () => {
      setHovered(null);
      canvas.style.cursor = "default";
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);

    let animationFrame = 0;
    const render = () => {
      animationFrame = window.requestAnimationFrame(render);
      controls.update();
      renderer.clear();
      renderer.render(scene, camera);
      renderer.clearDepth();
      renderer.render(overlayScene, camera);
    };
    render();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      renderer.dispose();
      disposeScene(scene);
      disposeScene(overlayScene);
      hoverTargetsRef.current = [];
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      sceneRef.current = null;
      overlaySceneRef.current = null;
    };
  }, [projection, up, viewPreset]);

  useEffect(() => {
    const scene = sceneRef.current;
    const overlayScene = overlaySceneRef.current;
    if (!scene || !overlayScene) {
      return;
    }
    disposeScene(scene);
    disposeScene(overlayScene);
    const buildResult = buildScene(scene);
    hoverTargetsRef.current = buildResult?.hoverTargets ?? [];
    for (const object of buildResult?.overlayObjects ?? []) {
      overlayScene.add(object);
    }
  }, [buildScene, projection, up, viewPreset]);

  return (
    <section className="viewport">
      <header className="viewport-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="viewport-actions">
          <button type="button" onClick={() => setViewPreset("side")}>
            Side
          </button>
          <button type="button" onClick={() => setViewPreset("front")}>
            Front
          </button>
          <button type="button" onClick={() => setViewPreset("top")}>
            Top
          </button>
          <button type="button" onClick={() => setViewPreset("corner")}>
            Corner
          </button>
          <button
            type="button"
            onClick={() =>
              setProjection((current) =>
                current === "perspective" ? "orthographic" : "perspective",
              )
            }
          >
            {projection === "perspective" ? "Orthographic" : "Perspective"}
          </button>
        </div>
      </header>
      <div className="viewport-body">
        <canvas ref={canvasRef} />
        {hovered ? (
          <div
            className="hover-label"
            style={{ left: hovered.x, top: hovered.y }}
          >
            {hovered.lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="control-row">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="checkbox-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function Vector3Field({
  title,
  labels,
  values,
  step = 0.1,
  onChange,
}: {
  title: string;
  labels: [string, string, string];
  values: [number, number, number];
  step?: number;
  onChange: (axis: "x" | "y" | "z", value: number) => void;
}) {
  const axes: Array<"x" | "y" | "z"> = ["x", "y", "z"];
  return (
    <div className="vector3-block">
      <div className="vector3-title">{title}</div>
      <div className="vector3-field">
      {labels.map((label) => (
        <span key={label} className="vector3-label">
          {label}
        </span>
      ))}
      {values.map((value, index) => (
        <input
          key={axes[index] ?? index}
          type="number"
          value={value}
          step={step}
          onChange={(event) =>
            onChange(axes[index] ?? "x", Number(event.target.value))
          }
        />
      ))}
      </div>
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="control-row">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="editor-card">
      <div className="editor-card-header">
        <h2>{title}</h2>
      </div>
      <div className="editor-grid">{children}</div>
    </section>
  );
}

function App() {
  const [cad, setCad] = useState(() => normalizeCadComponent(SAMPLE_CAD_COMPONENT));
  const [boardThickness, setBoardThickness] = useState(1.6);
  const [showBoard, setShowBoard] = useState(true);
  const [localModelFile, setLocalModelFile] = useState<File | null>(null);
  const [importText, setImportText] = useState(() =>
    JSON.stringify(SAMPLE_CAD_COMPONENT, null, 2),
  );
  const [importError, setImportError] = useState<string | null>(null);

  const debouncedCad = useDebouncedValue(cad, 350);
  const debouncedBoardThickness = useDebouncedValue(boardThickness, 350);
  const modelSource = useMemo<ModelSource>(() => {
    if (localModelFile) {
      return { kind: "file", file: localModelFile };
    }
    const modelUrl = debouncedCad.model_obj_url.trim();
    if (modelUrl) {
      return { kind: "url", value: modelUrl };
    }
    return { kind: "none" };
  }, [debouncedCad.model_obj_url, localModelFile]);
  const fallbackGeometry = useMemo(
    () => buildFallbackGeometry(debouncedCad),
    [debouncedCad],
  );
  const { geometry: fetchedGeometry, status, message } = useCadGeometry(modelSource);
  const geometry = fetchedGeometry ?? fallbackGeometry;
  const placement = useMemo(() => computePlacement(debouncedCad), [debouncedCad]);
  const geometryBounds = useMemo(() => getGeometryBounds(geometry), [geometry]);
  const generatedJson = useMemo(() => JSON.stringify(cad, null, 2), [cad]);
  const formatVec3 = (vector: THREE.Vector3) =>
    `(${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)})`;

  const update = <K extends keyof typeof cad>(key: K, value: (typeof cad)[K]) => {
    setCad((current) => ({ ...current, [key]: value }));
  };

  const updateVec3 = (
    key: "model_origin_position" | "position",
    axis: "x" | "y" | "z",
    value: number,
  ) => {
    setCad((current) => ({
      ...current,
      [key]: {
        ...current[key],
        [axis]: value,
      },
    }));
  };

  const updateSize = (
    axis: "x" | "y" | "z",
    value: number,
  ) => {
    setCad((current) => ({
      ...current,
      size: {
        ...current.size,
        [axis]: value,
      },
    }));
  };

  const importJson = () => {
    const parsed = parseInput(importText);
    if (!parsed.value) {
      setImportError(parsed.error ?? "Invalid JSON");
      return;
    }
    setCad(normalizeCadComponent(parsed.value));
    setLocalModelFile(null);
    setImportError(null);
  };

  const viewerScene = useMemo(
    () => (scene: THREE.Scene) => {
      addDefaultLights(scene);
      scene.add(makeGrid(90, 36, "z+"));
      if (showBoard) {
        scene.add(makeBoard(debouncedBoardThickness));
      }

      const placed = new THREE.Group();
      placed.rotation.copy(placement.rotation);
      placed.position.copy(placement.translation);
      placed.add(
        new THREE.Mesh(
          geometry.clone(),
          new THREE.MeshPhongMaterial({
            color: 0x79a8ff,
            transparent: true,
            opacity: 0.84,
            side: THREE.DoubleSide,
          }),
        ),
      );
      scene.add(placed);
      placed.updateMatrixWorld(true);
      const boardPosition = new THREE.Vector3(
        debouncedCad.position.x,
        debouncedCad.position.y,
        debouncedCad.position.z,
      );
      const boardPositionMarker = makeHoverMarker(boardPosition, [
        `Cad Component Position ${formatVec3(boardPosition)}`,
        `Anchor Alignment: ${debouncedCad.anchor_alignment}`,
      ]);
      const modelOriginWorld = placement.modelOrigin
        .clone()
        .applyEuler(placement.rotation)
        .add(placement.translation);
      const modelOriginMarker = makeHoverMarker(modelOriginWorld, [
        `Model Origin ${formatVec3(modelOriginWorld)}`,
        `Model Origin Alignment: ${debouncedCad.model_origin_alignment}`,
      ]);

      const placedBounds = geometryBounds.boundingBox
        .clone()
        .applyMatrix4(placed.matrixWorld);
      scene.add(makeAxesToBadgePositions(placedBounds));
      scene.add(makeAxisBadges(placedBounds));
      scene.add(
        makeBoardNormalArrow(
          modelOriginWorld,
          debouncedCad.model_board_normal_direction,
        ),
      );
      return {
        hoverTargets: [boardPositionMarker.target, modelOriginMarker.target],
        overlayObjects: [boardPositionMarker.group, modelOriginMarker.group],
      };
    },
    [
      debouncedCad.anchor_alignment,
      debouncedCad.model_board_normal_direction,
      debouncedCad.model_origin_alignment,
      debouncedBoardThickness,
      debouncedCad.position.x,
      debouncedCad.position.y,
      debouncedCad.position.z,
      geometry,
      geometryBounds.boundingBox,
      placement.modelOrigin,
      placement.rotation,
      placement.translation,
      showBoard,
    ],
  );

  const statusClass =
    status === "ready" ? "ok" : status === "loading" ? "loading" : "warning";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="hero">
          <p className="eyebrow">Circuit JSON</p>
          <h1>`cad_component` visualizer</h1>
          <p className="lede">
            Edit placement fields directly, then inspect OBJ or STEP geometry in
            a single board-space viewer with the board overlay toggled on or off.
          </p>
        </div>

        <div className={`status-pill ${statusClass}`}>{message}</div>

        <Section title="component model">
          <Vector3Field
            title="model_origin_position"
            labels={["x", "y", "z"]}
            values={[
              cad.model_origin_position.x,
              cad.model_origin_position.y,
              cad.model_origin_position.z,
            ]}
            onChange={(axis, value) => updateVec3("model_origin_position", axis, value)}
          />
          <SelectField<Alignment>
            label="model_origin_alignment"
            value={cad.model_origin_alignment}
            options={ALIGNMENT_OPTIONS}
            onChange={(value) => update("model_origin_alignment", value)}
          />
          <SelectField<AxisDirection>
            label="model_board_normal_direction"
            value={cad.model_board_normal_direction}
            options={NORMAL_OPTIONS}
            onChange={(value) => update("model_board_normal_direction", value)}
          />
        </Section>

        <Section title="component">
          <Vector3Field
            title="position"
            labels={["x", "y", "z"]}
            values={[cad.position.x, cad.position.y, cad.position.z]}
            onChange={(axis, value) => updateVec3("position", axis, value)}
          />
          <Vector3Field
            title="size"
            labels={["x", "y", "z"]}
            values={[cad.size.x, cad.size.y, cad.size.z]}
            onChange={(axis, value) => updateSize(axis, value)}
          />
          <SelectField<Alignment>
            label="anchor_alignment"
            value={cad.anchor_alignment}
            options={ALIGNMENT_OPTIONS}
            onChange={(value) => update("anchor_alignment", value)}
          />
        </Section>

        <Section title="model source">
          <label className="control-stack">
            <span>Model URL (.obj, .step, .stp)</span>
            <input
              type="text"
              value={cad.model_obj_url}
              onChange={(event) => {
                setLocalModelFile(null);
                update("model_obj_url", event.target.value);
              }}
            />
          </label>
          <label className="control-stack">
            <span>Local model file (.obj, .step, .stp)</span>
            <input
              type="file"
              accept=".obj,.step,.stp"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setLocalModelFile(file);
                if (file) {
                  update("model_obj_url", "");
                }
              }}
            />
          </label>
          {localModelFile ? (
            <div className="actions">
              <button type="button" onClick={() => setLocalModelFile(null)}>
                Clear local file ({localModelFile.name})
              </button>
            </div>
          ) : null}
        </Section>

        <details className="json-panel" open>
          <summary>board properties</summary>
          <div className="editor-grid details-grid">
            <NumberField
              label="board_thickness"
              value={boardThickness}
              onChange={setBoardThickness}
            />
            <CheckboxField
              label="show_board"
              checked={showBoard}
              onChange={setShowBoard}
            />
          </div>
        </details>

        <details className="json-panel">
          <summary>Circuit JSON</summary>
          <p className="json-help">
            Import by pasting JSON and clicking apply. The form controls stay
            authoritative for editing.
          </p>
          <label className="field">
            <span>Paste JSON</span>
            <textarea
              className="import-textarea"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="actions">
            <button type="button" onClick={importJson}>
              Apply pasted JSON
            </button>
          </div>
          {importError ? (
            <div className="status-pill error">JSON parse error: {importError}</div>
          ) : null}
          <label className="field">
            <span>Generated `cad_component`</span>
            <textarea
              className="json-output"
              value={generatedJson}
              readOnly
              spellCheck={false}
            />
          </label>
        </details>
      </aside>

      <section className="viewer-panel">
        <SceneCanvas
          title="Viewer"
          subtitle="The model is shown in board space. Toggle the green board overlay on or off."
          up={new THREE.Vector3(0, 0, 1)}
          buildScene={viewerScene}
        />
      </section>
    </main>
  );
}

export default App;

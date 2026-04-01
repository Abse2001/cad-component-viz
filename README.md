# cad-component-viz

React/Vite viewer for inspecting tscircuit cadModel and [Circuit JSON](https://github.com/tscircuit/circuit-json) `cad_component` placement.

This is most useful when trying to debug the correct loading of models into tscircuit to get them correctly placed on a board.

Supported model sources:

- Remote or local HTTP URLs for `.obj`, `.step`, `.stp`, `.gltf`, and `.glb`
- Local file upload from the browser for `.obj`, `.step`, `.stp`, `.gltf`, and `.glb`

Notes for glTF:

- Remote `.gltf` URLs can reference sibling `.bin` files and textures normally
- Local `.gltf` uploads need to be self-contained; multi-file local glTF packages are not resolved from the browser file picker

## Run locally

```bash
bun install
bun run start
```

Then open the Vite URL in your browser and either:

- paste a model URL into the `Model URL` field, or
- choose a local file from the `Local model file` picker

For repo-local files, you can also place a model under `public/` and load it with a URL like `/my-model.step`.

![viz](https://private-user-images.githubusercontent.com/1910070/563606458-35693bce-6e92-4633-933a-d039dbb6e4b6.png?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NzM1MTU1MDEsIm5iZiI6MTc3MzUxNTIwMSwicGF0aCI6Ii8xOTEwMDcwLzU2MzYwNjQ1OC0zNTY5M2JjZS02ZTkyLTQ2MzMtOTMzYS1kMDM5ZGJiNmU0YjYucG5nP1gtQW16LUFsZ29yaXRobT1BV1M0LUhNQUMtU0hBMjU2JlgtQW16LUNyZWRlbnRpYWw9QUtJQVZDT0RZTFNBNTNQUUs0WkElMkYyMDI2MDMxNCUyRnVzLWVhc3QtMSUyRnMzJTJGYXdzNF9yZXF1ZXN0JlgtQW16LURhdGU9MjAyNjAzMTRUMTkwNjQxWiZYLUFtei1FeHBpcmVzPTMwMCZYLUFtei1TaWduYXR1cmU9ZWY4N2MwOWFiMjMxZTM0ZTBlNDA4YmU2ZjIwY2JkYmYyNGNlMTY3Mzc3MjU2MjgyNmFmNGI3NWEyYTAxNmFiMyZYLUFtei1TaWduZWRIZWFkZXJzPWhvc3QifQ.UxPGoaIoR89mFZgJhy8e1DSgZX_rU34BRU8dptLP9SE)

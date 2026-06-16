import { CadComponentWorkbench } from "./components/app/CadComponentWorkbench"
import { ModelLoaderScreen } from "./components/app/ModelLoaderScreen"
import { useCadComponentEditor } from "./hooks/useCadComponentEditor"
import { useCadViewer } from "./hooks/useCadViewer"

function App() {
  const editor = useCadComponentEditor()
  const viewer = useCadViewer({
    cad: editor.cad,
    boardThickness: editor.boardThickness,
    localModelFile: editor.localModelFile,
    showBoard: editor.showBoard,
    showPlacement: editor.showPlacement,
  })

  if (editor.mode === "landing") {
    return <ModelLoaderScreen editor={editor} />
  }

  return <CadComponentWorkbench editor={editor} viewer={viewer} />
}

export default App

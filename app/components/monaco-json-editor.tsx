"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, XCircle, RotateCcw, Maximize2, Minimize2, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface MonacoJsonEditorProps {
  value: any
  onChange: (value: any) => void
  height?: string
  readOnly?: boolean
}

declare global {
  interface Window {
    monaco: any
    require: any
  }
}

export default function MonacoJsonEditor({
  value,
  onChange,
  height = "400px",
  readOnly = false,
}: MonacoJsonEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const editorInstanceRef = useRef<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isValid, setIsValid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    let mounted = true

    const loadMonaco = async () => {
      try {
        setIsLoading(true)
        setLoadError(null)

        // Check if Monaco is already loaded
        if (window.monaco) {
          if (mounted) {
            initializeEditor()
          }
          return
        }

        // Load Monaco from CDN
        const loaderScript = document.createElement("script")
        loaderScript.src = "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js"

        loaderScript.onload = () => {
          if (!mounted) return

          window.require.config({
            paths: {
              vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs",
            },
          })

          window.require(["vs/editor/editor.main"], () => {
            if (mounted) {
              initializeEditor()
            }
          })
        }

        loaderScript.onerror = () => {
          if (mounted) {
            setLoadError("Failed to load Monaco Editor")
            setIsLoading(false)
          }
        }

        document.head.appendChild(loaderScript)

        return () => {
          if (document.head.contains(loaderScript)) {
            document.head.removeChild(loaderScript)
          }
        }
      } catch (err) {
        if (mounted) {
          setLoadError("Failed to initialize Monaco Editor")
          setIsLoading(false)
        }
      }
    }

    const initializeEditor = () => {
      if (!editorRef.current || !window.monaco || !mounted) return

      try {
        // Configure JSON language
        window.monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
          validate: true,
          allowComments: false,
          schemas: [],
          enableSchemaRequest: false,
        })

        // Create editor instance
        editorInstanceRef.current = window.monaco.editor.create(editorRef.current, {
          value: JSON.stringify(value, null, 2),
          language: "json",
          theme: "vs",
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          readOnly: readOnly,
          fontSize: 14,
          lineNumbers: "on",
          folding: true,
          bracketMatching: "always",
          autoIndent: "full",
          formatOnPaste: true,
          formatOnType: true,
          tabSize: 2,
          insertSpaces: true,
          renderWhitespace: "selection",
          contextmenu: true,
          mouseWheelZoom: true,
          cursorBlinking: "blink",
          smoothScrolling: true,
        })

        // Handle content changes
        if (!readOnly) {
          editorInstanceRef.current.onDidChangeModelContent(() => {
            if (!mounted) return

            const currentValue = editorInstanceRef.current.getValue()
            try {
              const parsed = JSON.parse(currentValue)
              setIsValid(true)
              setError(null)
              onChange(parsed)
            } catch (err) {
              setIsValid(false)
              setError(err instanceof Error ? err.message : "Invalid JSON syntax")
            }
          })
        }

        // Handle validation markers
        const updateValidation = () => {
          if (!mounted || !editorInstanceRef.current) return

          const model = editorInstanceRef.current.getModel()
          if (model) {
            const markers = window.monaco.editor.getModelMarkers({ resource: model.uri })
            if (markers.length > 0) {
              setIsValid(false)
              setError(markers[0].message)
            } else {
              setIsValid(true)
              setError(null)
            }
          }
        }

        // Set up marker change listener
        const disposable = window.monaco.editor.onDidChangeMarkers(() => {
          updateValidation()
        })

        setIsLoading(false)

        return () => {
          disposable?.dispose()
        }
      } catch (err) {
        if (mounted) {
          setLoadError("Failed to create editor instance")
          setIsLoading(false)
        }
      }
    }

    loadMonaco()

    return () => {
      mounted = false
      if (editorInstanceRef.current) {
        editorInstanceRef.current.dispose()
        editorInstanceRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (editorInstanceRef.current && value) {
      const currentValue = editorInstanceRef.current.getValue()
      const newValue = JSON.stringify(value, null, 2)

      if (currentValue !== newValue) {
        editorInstanceRef.current.setValue(newValue)
      }
    }
  }, [value])

  const formatJson = () => {
    if (!editorInstanceRef.current) return

    try {
      const currentValue = editorInstanceRef.current.getValue()
      const parsed = JSON.parse(currentValue)
      const formatted = JSON.stringify(parsed, null, 2)

      editorInstanceRef.current.setValue(formatted)
      editorInstanceRef.current.getAction("editor.action.formatDocument")?.run()

      toast({
        title: "JSON formatted",
        description: "JSON has been formatted successfully",
      })
    } catch (err) {
      toast({
        title: "Format failed",
        description: "Cannot format invalid JSON",
        variant: "destructive",
      })
    }
  }

  const resetJson = () => {
    if (!editorInstanceRef.current) return

    try {
      const originalValue = JSON.stringify(value, null, 2)
      editorInstanceRef.current.setValue(originalValue)

      toast({
        title: "JSON reset",
        description: "JSON has been reset to original value",
      })
    } catch (err) {
      toast({
        title: "Reset failed",
        description: "Cannot reset JSON",
        variant: "destructive",
      })
    }
  }

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen)

    // Trigger layout update after fullscreen toggle
    setTimeout(() => {
      if (editorInstanceRef.current) {
        editorInstanceRef.current.layout()
      }
    }, 100)
  }

  if (loadError) {
    return (
      <div
        className="flex flex-col items-center justify-center p-8 border rounded-lg bg-red-50 border-red-200"
        style={{ height }}
      >
        <XCircle className="w-8 h-8 text-red-500 mb-2" />
        <p className="text-red-700 font-medium">Failed to load Monaco Editor</p>
        <p className="text-red-600 text-sm mt-1">{loadError}</p>
        <div className="mt-4 p-4 bg-white border rounded-lg w-full max-h-64 overflow-auto">
          <pre className="text-sm text-gray-800">
            <code>{JSON.stringify(value, null, 2)}</code>
          </pre>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center p-8 border rounded-lg bg-blue-50 border-blue-200"
        style={{ height }}
      >
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          <span className="text-blue-800 font-medium">Loading Monaco Editor...</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`w-full ${isFullscreen ? "fixed inset-0 z-50 bg-white" : ""}`}>
      {/* Editor Header */}
      <div className="flex items-center justify-between p-3 bg-gray-50 border-b">
        <div className="flex items-center gap-2">
          <Badge variant={isValid ? "default" : "destructive"} className="flex items-center gap-1">
            {isValid ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {isValid ? "Valid JSON" : "Invalid JSON"}
          </Badge>
          <Badge variant="outline" className="text-xs">
            Monaco Editor
          </Badge>
        </div>

        {!readOnly && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={formatJson} disabled={!isValid}>
              Format
            </Button>
            <Button size="sm" variant="outline" onClick={resetJson}>
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </Button>
            <Button size="sm" variant="outline" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </Button>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700 font-medium">{error}</p>
        </div>
      )}

      {/* Monaco Editor Container */}
      <div
        ref={editorRef}
        className="w-full"
        style={{
          height: isFullscreen ? "calc(100vh - 120px)" : height,
        }}
      />

      {/* Editor Footer */}
      <div className="flex items-center justify-between p-2 bg-gray-50 border-t text-xs text-gray-600">
        <div className="flex items-center gap-4">
          <span>Monaco Editor</span>
          <span>JSON Language Support</span>
          {!readOnly && <span>Ctrl+Shift+F to format</span>}
        </div>
        <div className="flex items-center gap-2">
          <span>Syntax Highlighting • IntelliSense • Error Detection</span>
        </div>
      </div>
    </div>
  )
}

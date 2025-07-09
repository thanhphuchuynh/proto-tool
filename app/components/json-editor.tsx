"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, XCircle, RotateCcw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface JsonEditorProps {
  value: any
  onChange: (value: any) => void
  height?: string
  readOnly?: boolean
}

export default function JsonEditor({ value, onChange, height = "300px", readOnly = false }: JsonEditorProps) {
  const [jsonString, setJsonString] = useState("")
  const [isValid, setIsValid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lineCount, setLineCount] = useState(1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()

  useEffect(() => {
    try {
      const formatted = JSON.stringify(value, null, 2)
      setJsonString(formatted)
      setIsValid(true)
      setError(null)
      setLineCount(formatted.split("\n").length)
    } catch (err) {
      setError("Invalid JSON object")
      setIsValid(false)
    }
  }, [value])

  const handleChange = (newValue: string) => {
    setJsonString(newValue)
    setLineCount(newValue.split("\n").length)

    try {
      const parsed = JSON.parse(newValue)
      setIsValid(true)
      setError(null)
      onChange(parsed)
    } catch (err) {
      setIsValid(false)
      setError(err instanceof Error ? err.message : "Invalid JSON syntax")
    }
  }

  const formatJson = () => {
    try {
      const parsed = JSON.parse(jsonString)
      const formatted = JSON.stringify(parsed, null, 2)
      setJsonString(formatted)
      setLineCount(formatted.split("\n").length)
      setIsValid(true)
      setError(null)
      onChange(parsed)
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
    try {
      const formatted = JSON.stringify(value, null, 2)
      setJsonString(formatted)
      setLineCount(formatted.split("\n").length)
      setIsValid(true)
      setError(null)
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault()
      const start = e.currentTarget.selectionStart
      const end = e.currentTarget.selectionEnd
      const newValue = jsonString.substring(0, start) + "  " + jsonString.substring(end)
      setJsonString(newValue)
      handleChange(newValue)

      // Set cursor position after the inserted spaces
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2
        }
      }, 0)
    }
  }

  return (
    <div className="w-full">
      {/* Editor Header */}
      <div className="flex items-center justify-between p-3 bg-muted/50 border-b">
        <div className="flex items-center gap-2">
          <Badge variant={isValid ? "default" : "destructive"} className="flex items-center gap-1">
            {isValid ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {isValid ? "Valid JSON" : "Invalid JSON"}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {lineCount} lines
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
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-2 bg-destructive/10 border-b border-destructive/20">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* JSON Editor */}
      <div className="relative">
        {/* Line Numbers */}
        <div className="absolute left-0 top-0 bottom-0 w-12 bg-muted/30 border-r flex flex-col text-xs text-muted-foreground font-mono">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i + 1} className="px-2 py-0.5 text-right leading-6">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Text Area */}
        <textarea
          ref={textareaRef}
          value={jsonString}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          readOnly={readOnly}
          className={`
            w-full pl-14 pr-4 py-2 font-mono text-sm leading-6 resize-none
            bg-background border-0 outline-none
            ${readOnly ? "cursor-default" : "cursor-text"}
          `}
          style={{ height }}
          placeholder={readOnly ? "" : "Enter JSON data..."}
          spellCheck={false}
        />
      </div>

      {/* Editor Footer */}
      <div className="flex items-center justify-between p-2 bg-muted/30 border-t text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span>JSON Editor</span>
          {!readOnly && <span>Press Tab to indent</span>}
        </div>
        <div className="flex items-center gap-2">
          <span>{jsonString.length} characters</span>
        </div>
      </div>
    </div>
  )
}

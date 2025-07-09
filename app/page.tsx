"use client"

import type React from "react"

import { useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FileText, Binary, ArrowRight, Copy, Download, AlertCircle, Info, Code, Eye } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import MonacoJsonEditor from "./components/monaco-json-editor"

interface ProtoField {
  type: string
  name: string
  number: number
  repeated: boolean
  optional: boolean
}

interface ProtoMessage {
  name: string
  fields: ProtoField[]
}

interface ProtoSchema {
  package: string
  messages: ProtoMessage[]
}

interface ProtoFile {
  name: string
  content: string
  size: number
  schema?: ProtoSchema
}

interface BinaryFile {
  name: string
  content: ArrayBuffer
  size: number
}

interface DecodedData {
  [key: string]: any
}

export default function ProtoBinaryDecoder() {
  const [protoFile, setProtoFile] = useState<ProtoFile | null>(null)
  const [binaryFile, setBinaryFile] = useState<BinaryFile | null>(null)
  const [decodedData, setDecodedData] = useState<DecodedData | null>(null)
  const [editedData, setEditedData] = useState<DecodedData | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<string>("")
  const [isDecoding, setIsDecoding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"preview" | "editor">("preview")
  const { toast } = useToast()

  const parseProtoFile = (content: string): ProtoSchema => {
    const schema: ProtoSchema = {
      package: "",
      messages: [],
    }

    // Extract package name
    const packageMatch = content.match(/package\s+([^;]+);/)
    if (packageMatch) {
      schema.package = packageMatch[1].trim()
    }

    // Extract message definitions
    const messageRegex = /message\s+(\w+)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g
    let messageMatch

    while ((messageMatch = messageRegex.exec(content)) !== null) {
      const messageName = messageMatch[1]
      const messageBody = messageMatch[2]

      const message: ProtoMessage = {
        name: messageName,
        fields: [],
      }

      // Extract field definitions
      const fieldRegex = /(repeated\s+|optional\s+)?(\w+)\s+(\w+)\s*=\s*(\d+);/g
      let fieldMatch

      while ((fieldMatch = fieldRegex.exec(messageBody)) !== null) {
        const modifier = fieldMatch[1]?.trim() || ""
        const type = fieldMatch[2]
        const name = fieldMatch[3]
        const number = Number.parseInt(fieldMatch[4])

        message.fields.push({
          type,
          name,
          number,
          repeated: modifier === "repeated",
          optional: modifier === "optional",
        })
      }

      schema.messages.push(message)
    }

    return schema
  }

  const decodeVarint = (data: Uint8Array, offset: number): { value: number; newOffset: number } => {
    let result = 0
    let shift = 0
    let currentOffset = offset

    while (currentOffset < data.length) {
      const byte = data[currentOffset]
      result |= (byte & 0x7f) << shift

      if ((byte & 0x80) === 0) {
        return { value: result, newOffset: currentOffset + 1 }
      }

      shift += 7
      currentOffset++

      if (shift >= 64) {
        throw new Error("Varint too long")
      }
    }

    throw new Error("Unexpected end of data while reading varint")
  }

  const decodeString = (data: Uint8Array, offset: number, length: number): string => {
    const bytes = data.slice(offset, offset + length)
    return new TextDecoder().decode(bytes)
  }

  const decodeProtobufData = (binaryData: ArrayBuffer, message: ProtoMessage): DecodedData => {
    const data = new Uint8Array(binaryData)
    const result: DecodedData = {}
    let offset = 0

    // Initialize repeated fields as arrays
    message.fields.forEach((field) => {
      if (field.repeated) {
        result[field.name] = []
      }
    })

    while (offset < data.length) {
      try {
        // Read field tag (field number + wire type)
        const { value: tag, newOffset: tagOffset } = decodeVarint(data, offset)
        offset = tagOffset

        const fieldNumber = tag >>> 3
        const wireType = tag & 0x07

        // Find field definition
        const field = message.fields.find((f) => f.number === fieldNumber)
        if (!field) {
          // Skip unknown field
          offset = skipField(data, offset, wireType)
          continue
        }

        let value: any

        switch (wireType) {
          case 0: // Varint
            const { value: varintValue, newOffset: varintOffset } = decodeVarint(data, offset)
            offset = varintOffset

            if (field.type === "bool") {
              value = varintValue !== 0
            } else if (field.type === "int32" || field.type === "int64") {
              value = varintValue
            } else {
              value = varintValue
            }
            break

          case 2: // Length-delimited
            const { value: length, newOffset: lengthOffset } = decodeVarint(data, offset)
            offset = lengthOffset

            if (field.type === "string") {
              value = decodeString(data, offset, length)
            } else if (field.type === "bytes") {
              value = Array.from(data.slice(offset, offset + length))
            } else {
              // Could be a nested message or packed repeated field
              value = `<${field.type} data: ${length} bytes>`
            }
            offset += length
            break

          case 1: // 64-bit
            // Read 8 bytes for double/fixed64
            if (offset + 8 <= data.length) {
              const bytes = data.slice(offset, offset + 8)
              value = `<64-bit: ${Array.from(bytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(" ")}>`
              offset += 8
            } else {
              throw new Error("Not enough data for 64-bit field")
            }
            break

          case 5: // 32-bit
            // Read 4 bytes for float/fixed32
            if (offset + 4 <= data.length) {
              const bytes = data.slice(offset, offset + 4)
              if (field.type === "float") {
                const view = new DataView(bytes.buffer, bytes.byteOffset, 4)
                value = view.getFloat32(0, true) // little-endian
              } else {
                value = `<32-bit: ${Array.from(bytes)
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join(" ")}>`
              }
              offset += 4
            } else {
              throw new Error("Not enough data for 32-bit field")
            }
            break

          default:
            throw new Error(`Unknown wire type: ${wireType}`)
        }

        // Store the value
        if (field.repeated) {
          result[field.name].push(value)
        } else {
          result[field.name] = value
        }
      } catch (err) {
        console.error("Error decoding field:", err)
        break
      }
    }

    return result
  }

  const skipField = (data: Uint8Array, offset: number, wireType: number): number => {
    switch (wireType) {
      case 0: // Varint
        const { newOffset } = decodeVarint(data, offset)
        return newOffset
      case 1: // 64-bit
        return offset + 8
      case 2: // Length-delimited
        const { value: length, newOffset: lengthOffset } = decodeVarint(data, offset)
        return lengthOffset + length
      case 5: // 32-bit
        return offset + 4
      default:
        throw new Error(`Cannot skip unknown wire type: ${wireType}`)
    }
  }

  const handleProtoUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      if (!file.name.endsWith(".proto")) {
        toast({
          title: "Invalid file type",
          description: "Please upload a .proto file",
          variant: "destructive",
        })
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        try {
          const schema = parseProtoFile(content)
          const protoFileData: ProtoFile = {
            name: file.name,
            content,
            size: file.size,
            schema,
          }
          setProtoFile(protoFileData)
          setSelectedMessage(schema.messages[0]?.name || "")
          setError(null)
          toast({
            title: "Proto file uploaded",
            description: `Found ${schema.messages.length} message(s)`,
          })
        } catch (err) {
          setError(`Failed to parse proto file: ${err instanceof Error ? err.message : "Unknown error"}`)
        }
      }
      reader.readAsText(file)
    },
    [toast],
  )

  const handleBinaryUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as ArrayBuffer
        setBinaryFile({
          name: file.name,
          content,
          size: file.size,
        })
        setError(null)
        toast({
          title: "Binary file uploaded",
          description: `${file.name} loaded successfully`,
        })
      }
      reader.readAsArrayBuffer(file)
    },
    [toast],
  )

  const decodeData = async () => {
    if (!protoFile || !binaryFile || !selectedMessage) {
      setError("Proto file, binary file, and message type selection are required")
      return
    }

    if (!protoFile.schema) {
      setError("Proto file schema not parsed")
      return
    }

    const message = protoFile.schema.messages.find((m) => m.name === selectedMessage)
    if (!message) {
      setError("Selected message not found in schema")
      return
    }

    setIsDecoding(true)
    setError(null)

    try {
      const decoded = decodeProtobufData(binaryFile.content, message)
      const finalData = {
        _metadata: {
          message_type: selectedMessage,
          package: protoFile.schema.package,
          binary_size: binaryFile.size,
          decoded_at: new Date().toISOString(),
        },
        ...decoded,
      }
      setDecodedData(finalData)
      setEditedData(finalData)

      toast({
        title: "Decoding successful",
        description: `Binary data decoded as ${selectedMessage}`,
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to decode binary data"
      setError(errorMessage)
      toast({
        title: "Decoding failed",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsDecoding(false)
    }
  }

  const handleJsonChange = (newData: DecodedData) => {
    setEditedData(newData)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast({
      title: "Copied",
      description: "JSON data copied to clipboard",
    })
  }

  const downloadJson = () => {
    const dataToDownload = editedData || decodedData
    if (!dataToDownload) return

    const blob = new Blob([JSON.stringify(dataToDownload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `decoded_${selectedMessage}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto p-4 sm:p-6 max-w-7xl">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-gray-900">Protobuf Binary Decoder</h1>
          <p className="text-sm sm:text-base text-gray-600">
            Upload a .proto schema file and binary data to decode according to the actual message structure
          </p>
        </div>

        <div className="space-y-6">
          {/* Input Section */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Proto File Upload */}
            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="w-5 h-5 text-blue-600" />
                  Proto Schema
                </CardTitle>
                <CardDescription>Upload your .proto file to define the message structure</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="proto-upload" className="text-sm font-medium">
                    Select .proto file
                  </Label>
                  <Input
                    id="proto-upload"
                    type="file"
                    accept=".proto"
                    onChange={handleProtoUpload}
                    className="mt-2 cursor-pointer"
                  />
                </div>

                {protoFile && protoFile.schema && (
                  <div className="space-y-4">
                    <div className="p-4 border rounded-lg bg-green-50 border-green-200">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="w-4 h-4 text-green-600" />
                        <span className="font-medium text-green-800 truncate">{protoFile.name}</span>
                        <Badge variant="secondary" className="ml-auto">
                          {formatBytes(protoFile.size)}
                        </Badge>
                      </div>
                      <div className="text-sm text-green-700">
                        Package: <code className="bg-green-100 px-1 rounded">{protoFile.schema.package || "none"}</code>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="message-select" className="text-sm font-medium">
                        Select Message Type
                      </Label>
                      <select
                        id="message-select"
                        value={selectedMessage}
                        onChange={(e) => setSelectedMessage(e.target.value)}
                        className="w-full mt-2 p-2 border rounded-md bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        {protoFile.schema.messages.map((message) => (
                          <option key={message.name} value={message.name}>
                            {message.name} ({message.fields.length} fields)
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedMessage && (
                      <div className="p-4 border rounded-lg bg-blue-50 border-blue-200">
                        <h4 className="font-medium mb-3 text-blue-900">Message Structure: {selectedMessage}</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                          {protoFile.schema.messages
                            .find((m) => m.name === selectedMessage)
                            ?.fields.map((field) => (
                              <div key={field.name} className="flex items-center gap-2 p-2 bg-white rounded border">
                                <Badge variant="outline" className="text-xs font-mono shrink-0">
                                  {field.number}
                                </Badge>
                                <div className="text-sm text-blue-800 truncate">
                                  <span className="font-medium">
                                    {field.repeated && "repeated "}
                                    {field.optional && "optional "}
                                    {field.type}
                                  </span>
                                  <span className="text-blue-600 ml-1">{field.name}</span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Binary File Upload */}
            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Binary className="w-5 h-5 text-purple-600" />
                  Binary Data
                </CardTitle>
                <CardDescription>Upload your binary protobuf file to decode</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="binary-upload" className="text-sm font-medium">
                    Select binary file
                  </Label>
                  <Input id="binary-upload" type="file" onChange={handleBinaryUpload} className="mt-2 cursor-pointer" />
                </div>

                {binaryFile && (
                  <div className="p-4 border rounded-lg bg-purple-50 border-purple-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Binary className="w-4 h-4 text-purple-600" />
                      <span className="font-medium text-purple-800 truncate">{binaryFile.name}</span>
                      <Badge variant="secondary" className="ml-auto">
                        {formatBytes(binaryFile.size)}
                      </Badge>
                    </div>
                    <div className="text-sm text-purple-700">
                      <div className="font-medium mb-1">Binary Preview:</div>
                      <code className="bg-purple-100 px-2 py-1 rounded text-xs font-mono break-all">
                        {new Uint8Array(binaryFile.content).slice(0, 32).join(" ")}
                        {binaryFile.size > 32 && "..."}
                      </code>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Decode Button */}
          <div className="flex justify-center">
            <Button
              onClick={decodeData}
              disabled={!protoFile || !binaryFile || !selectedMessage || isDecoding}
              size="lg"
              className="px-8 py-3 text-base font-medium"
            >
              {isDecoding ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Decoding...
                </>
              ) : (
                <>
                  <ArrowRight className="w-5 h-5 mr-2" />
                  Decode Binary Data
                </>
              )}
            </Button>
          </div>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive" className="shadow-sm">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="font-medium">{error}</AlertDescription>
            </Alert>
          )}

          {/* Results Section */}
          {decodedData && (
            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <FileText className="w-5 h-5 text-green-600" />
                      Decoded JSON Data
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Binary data decoded using {selectedMessage} message structure
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(JSON.stringify(editedData || decodedData, null, 2))}
                      className="flex items-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={downloadJson}
                      className="flex items-center gap-2 bg-transparent"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as "preview" | "editor")}>
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="preview" className="flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      Preview
                    </TabsTrigger>
                    <TabsTrigger value="editor" className="flex items-center gap-2">
                      <Code className="w-4 h-4" />
                      Monaco Editor
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="preview">
                    <div className="border rounded-lg overflow-hidden">
                      <pre className="bg-gray-50 p-4 overflow-x-auto text-sm max-h-96 overflow-y-auto">
                        <code className="text-gray-800">{JSON.stringify(editedData || decodedData, null, 2)}</code>
                      </pre>
                    </div>
                  </TabsContent>

                  <TabsContent value="editor">
                    <div className="border rounded-lg overflow-hidden bg-white">
                      <MonacoJsonEditor value={editedData || decodedData} onChange={handleJsonChange} height="500px" />
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}

          {/* Instructions */}
          <Alert className="shadow-sm border-blue-200 bg-blue-50">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              <strong>How it works:</strong> The decoder parses your .proto file to understand the message structure,
              then decodes the binary data according to the protobuf wire format. Use the Monaco Editor tab for advanced
              JSON editing with syntax highlighting, IntelliSense, and error detection.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  )
}
